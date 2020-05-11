var map;
var plotLayer;
var obstacleLayer;
var shadowLayer;
var gridLayer; 
var drawPlot;
var drawObstacles;
var geoJson = new ol.format.GeoJSON();

const nb = 100;

function shadeStyle(feature) {
    const shade = feature.getProperties().shade / nb;
    return [new ol.style.Style({
        fill: new ol.style.Fill({
            color: `rgba(0,0,0,${shade})`
        })
    })];
}

function loadElements() {
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

    let plotGeom = plotLayer.getSource().getFeatures()[0].getGeometry();
    const plotExtent = plotGeom.getExtent();
    const center = [(plotExtent[0] + plotExtent[2])/2, (plotExtent[1] + plotExtent[3])/2];

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
    gridLayer.getSource().addFeatures(grid);

    const obstacleGeom = obstacleLayer.getSource().getFeatures()
        .map(feat => ({
            floor: getRelativeCoordinates(feat.getGeometry().getCoordinates()[0]),
            roof: feat.getGeometry().getCoordinates()[0]
                .map(coord => [coord[0] - center[0], coord[1] - center[1], Number(feat.getProperties().height)]),
        })
    );
    plotGeom = [getRelativeCoordinates(plotGeom.getCoordinates()[0])];
    // console.log(obstacleGeom);

    new Array(nb + 1).fill(0).map((el, idx) => (idx/nb) * Math.PI).forEach(angle => {
        const solar = getSolarCoordinatesForAngle(angle);
        const shadows = obstacleGeom
            .map(obstacle => turf.intersect(
                turf.polygon(plotGeom),
                getShadowForObstacle(solar, obstacle.roof, obstacle.floor)
            )).filter(shadow => !!shadow);
        const shadowGeom = shadows.map(shadow => new ol.geom.Polygon(getAbsoluteCoordinates(shadow)));
        grid.forEach(gridEl => {
            const shade = gridEl.getProperties().shade;
            if (shadowGeom.some(sgeom => sgeom.intersectsCoordinate(gridEl.getGeometry().getFirstCoordinate()))) {
                gridEl.setProperties({shade: shade + 1});
            }
        })
    })

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
        return convexHull(obs_ground.concat(shadowPoints));
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
        return polygon.map(coord => [coord[0] - Number(center[0]), coord[1] - Number(center[1])]);
    }

    function getAbsoluteCoordinates(feature) {
        if (feature.geometry.type === 'Polygon') {
            return feature.geometry.coordinates.map(ring => ring.map(coord => [coord[0] + Number(center[0]), coord[1] + Number(center[1])]));
        } else {
            return feature.geometry.coordinates.map(polygon => 
                polygon.map(ring => ring.map(coord => [coord[0] + Number(center[0]), coord[1] + Number(center[1])])));
        }
        return ;
    }
}
