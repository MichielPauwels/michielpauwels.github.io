var map;
var plotLayer;
var obstacleLayer;
var shadowLayer;
var gridLayer; 
var drawPlot;
var drawObstacles;
var geoJson = new ol.format.GeoJSON();

const nb_angles = 100;

function shadeStyle(feature) {
    const shade = 255 - (feature.getProperties().shade / nb_angles) * 255;
    return [new ol.style.Style({
        fill: new ol.style.Fill({
            color: `rgba(${shade}, ${shade}, ${shade}, 0.8)`
        })
    })];
}

function loadElements() {
    loadMap();
    loadLegend();
}

function loadLegend() {
    const grid = 5;
    const diff = 100 / grid;
    const legendDiv = document.getElementById('legend');
    const table = document.createElement('table');
    table.style.borderCollapse = 'collapse';
    table.style.textAlign = 'center';
    legendDiv.appendChild(table);
    const tbdy = document.createElement('tbody');
    table.appendChild(tbdy);
    const imgRow = document.createElement('tr');
    imgRow.style.height = '30px';
    const axisRow = document.createElement('tr');
    new Array(grid + 1).fill(0).forEach((el, idx) => {
        const td = document.createElement('td');
        td.appendChild(document.createTextNode(idx * diff));
        td.style.width = '30px';
        axisRow.appendChild(td);
        const tdColor = document.createElement('td');
        const val = idx * diff / 100;
        tdColor.style.background = 
            `linear-gradient(90deg, rgba(0,0,0,${val - diff / 200}) 0%, rgba(0,0,0,${val}) 48%, rgba(0,0,0,1) 49%, rgba(0,0,0,1) 51%, rgba(0,0,0,${val}) 52%, rgba(0,0,0,${val + diff / 200}) 100%)`
        if (idx === grid) {
            tdColor.style.background = 
            `linear-gradient(90deg, rgba(0,0,0,${val - diff / 200}) 0%, rgba(0,0,0,${val}) 48%, rgba(0,0,0,0) 49%, rgba(0,0,0,0) 100%)`
        }
        imgRow.appendChild(tdColor);
    });
    tbdy.appendChild(imgRow);
    tbdy.appendChild(axisRow);
}

function loadMap() {
    plotLayer = new ol.layer.Vector({source: new ol.source.Vector()});
    obstacleLayer = new ol.layer.Vector({source: new ol.source.Vector()});
    shadowLayer = new ol.layer.Vector({source: new ol.source.Vector()});
    gridLayer = new ol.layer.Vector({source: new ol.source.Vector(), style: shadeStyle});
    drawPlot = new ol.interaction.Draw({
        source: plotLayer.getSource(),
        type: 'Polygon'
    });
    drawObstacles = new ol.interaction.Draw({
        source: obstacleLayer.getSource(),
        type: 'Polygon',
    });
    obstacleLayer.getSource().on('addfeature', (e) => e.feature.setProperties({height: prompt("hoogte obstakel (m)")}));
    drawPlot.setActive(false);
    drawObstacles.setActive(false);
    const select = new ol.interaction.Select({wrapX: false});
    const modify = new ol.interaction.Modify({features: select.getFeatures()});
    map = new ol.Map({
        target: 'map',
        layers: [
          new ol.layer.Tile({
            source: new ol.source.OSM()
          }),
          plotLayer,
          obstacleLayer,
          shadowLayer,
          gridLayer
        ],
        view: new ol.View({
          center: ol.proj.fromLonLat([4.665750, 51.052380]),
          zoom: 17
        })
    });
    map.addInteraction(drawPlot);
    map.addInteraction(drawObstacles);
    map.addInteraction(select);
    map.addInteraction(modify);
}

function activateDrawPlot() {
    drawObstacles.setActive(false);
    drawPlot.setActive(true);
}

function activateDrawObstacles() {
    drawPlot.setActive(false);
    drawObstacles.setActive(true);
}

function calculateShadow() {

    let plotGeom = new ol.geom.MultiPolygon(plotLayer.getSource().getFeatures().map(feat => feat.getGeometry()));
    const plotExtent = plotGeom.getExtent();
    const center = [(plotExtent[0] + plotExtent[2])/2, (plotExtent[1] + plotExtent[3])/2];

    const grid = getGrid();

    const obstacleGeom = obstacleLayer.getSource().getFeatures()
        .map(feat => {
            const relativeGeomCoord = getRelativeCoordinates(feat.getGeometry()).getCoordinates()[0];
            return {
                floor: relativeGeomCoord,
                roof: relativeGeomCoord.map(coord => [...coord, Number(feat.getProperties().height)]),
            };
        }
    );

    new Array(nb_angles + 1).fill(0).map((el, idx) => (idx/nb_angles) * Math.PI)
    .map(angle => getSolarCoordinatesForAngle(angle))
    .forEach(solar => checkGridForShadows(grid, getShadowsForObstacles(solar, obstacleGeom)))

    function getShadowsForObstacles(solar, obstacleGeom) {
        const shadows = [];
        obstacleGeom.forEach(obstacle => {
            const castShadow = getShadowForObstacle(solar, obstacle.roof, obstacle.floor);
            plotGeom.getPolygons().forEach(plot => {
                const overlappingShadow = turf.intersect(turf.polygon(plot.getCoordinates()), castShadow);
                if (!!overlappingShadow) {
                    shadows.push(geoJson.readFeature(overlappingShadow).getGeometry());
                }
            })
        });
        return shadows;
    }

    function checkGridForShadows(grid, shadows) {
        grid.forEach(gridEl => {
            const shade = gridEl.getProperties().shade;
            if (shadows.some(sgeom => sgeom.intersectsCoordinate(ol.extent.getCenter(gridEl.getGeometry().getExtent())))) {
                gridEl.setProperties({shade: shade + 1});
            }
        });
    }

    function getGrid() {
        const gridSize = 100;
        const delta = Math.abs(plotExtent[0] - plotExtent[2]) / gridSize;
        const grid = [];
        const startX = Math.min(plotExtent[0], plotExtent[2]);
        const startY = Math.max(plotExtent[1], plotExtent[3])
        let currentY = startY;
        let yIdx = 0;
        while(currentY > Math.min(plotExtent[1], plotExtent[3])) {
            grid.push(...new Array(gridSize).fill(0).map((el, xIdx) => (geoJson.readFeature({
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[
                        [startX + xIdx * delta, startY - yIdx * delta],
                        [startX + (xIdx + 1) * delta, startY - yIdx * delta],
                        [startX + (xIdx + 1) * delta, startY - (yIdx + 1) * delta],
                        [startX + xIdx * delta, startY - (yIdx + 1) * delta],
                        [startX + xIdx * delta, startY - yIdx * delta]
                    ]]
                },
                properties: {
                    shade: 0
                }
            }))).filter((el, xIdx) => plotGeom.intersectsCoordinate(
                [startX + (xIdx + 0.5) * delta, startY - (yIdx + 0.5) * delta]
            )));
            yIdx++;
            currentY = currentY - delta;
        }
        gridLayer.getSource().clear();
        gridLayer.getSource().addFeatures(grid);
        return grid;
    }

    function getSolarCoordinatesForAngle(phi) {
        const saa = 0.68 //Solar Altitude Angle (rad)
        const r = 100000000;
        const pi = Math.PI;
        const theta = pi/2 - saa * Math.sin(phi);
        return [
            r*Math.sin(-theta)*Math.cos(phi),
            r*Math.sin(-theta)*Math.sin(phi),
            r*Math.cos(-theta)
        ]
    }

    function getShadowForObstacle(solarPoint, obs_roof, obs_ground) {
        const shadowPoints = obs_roof.map(roofPoint => getShadowPoint(solarPoint, roofPoint));
        return geoJson.writeFeatureObject(
            new ol.Feature(getAbsoluteCoordinates(
                geoJson.readFeature(convexHull(obs_ground.concat(shadowPoints))).getGeometry()
            ))
        );
    }

    function getSolarLine(solarPoint) {
        return new ol.Feature(getAbsoluteCoordinates(
            new ol.geom.LineString([[solarPoint[0], solarPoint[1]], [0, 0]])
        ));
    }

    function getShadowPoint(solarPoint, roofPoint) {
        const xz = solarPoint[0];
        const yz = solarPoint[1];
        const zz = solarPoint[2];
        const xd = roofPoint[0];
        const yd = roofPoint[1];
        const zd = roofPoint[2];
        const r = zz / (zz - zd);
        return [xz + r * (xd - xz), yz + r * (yd - yz)];
    }
    function convexHull(points) {
        const turfCollection = turf.featureCollection(points.map(point => turf.point(point)));
        return turf.convex(turfCollection);
    }

    function getRelativeCoordinates(polygon) {
        polygon.translate(- Number(center[0]), - Number(center[1]));
        return polygon;
    }

    function getAbsoluteCoordinates(polygon) {
        polygon.translate(Number(center[0]),Number(center[1]));
        return polygon;
    }
}
