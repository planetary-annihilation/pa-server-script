var main = require('main');
var server = require('server');
var sim = require('sim');
var utils = require('utils');
var _ = require('thirdparty/lodash');

var client_state = {
    armies: []
};

var players = {};
var armies = [];

var cleanup = [];

function updateArmyState(transmit) {
    if (transmit) {
        server.broadcast({
            message_type: 'army_state',
            payload: client_state.armies
        });
    }
}

function updateBeacon() {
    server.beacon = undefined;
}

function defeatArmy(army) {
    army.sim.defeated = true;
    army.defeated = true;
}

function updateGameOverState() {
    var aliveCount = _.reduce(armies, function(sum, army) { return sum + (army.defeated ? 0 : 1); }, 0);
    if (aliveCount > 1)
        return;

    sim.paused = true;
    setTimeout(function() {
        sim.onShutdown = server.exit;
        sim.shutdown(true);
    }, 5000);
}

function tickDefeatState() {
    _.forEach(armies, function(army) {
        if (army.defeated)
            return;
        if (army.commander.dead)
            defeatArmy(army);
    });
    updateGameOverState();
}

function spawnUnit(army, spec, planet, position, orientation) {
    var creationCheck = sim.units.length;
    sim.units.push({
        army: army.sim,
        spec: spec,
        planet: planet,
        position: position,
        orientation: orientation
    });
    if (creationCheck !== sim.units.length) {
        return _.last(sim.units);
    }
    else
        console.error("Failed spawning unit", spec);
}

// Note: Must be called after the armies have been filled in
function createLandingZones(config) {
    var planetConfig = config.system.planets[0];
    var planetRadius = planetConfig.generator.radius;
    
    var maxZonesPerArmy = Math.min(Math.ceil(planetRadius / 300), 4);
    
    var zoneRadius = planetRadius / 5;
    var bufferRadius = planetRadius * 0.2;
    
    var zones;
    _.forEach(sim.planets, function (planet, index) {
        if (index === 0)
            zones = planet.genMetalAndLandingSpots(maxZonesPerArmy, zoneRadius, bufferRadius, sim.armies.length);
        else
            planet.genMetalSpots();
    });
    return zones;
}

function assignLandingZones(landingZones) {
    var positions = _.shuffle(landingZones.positions.slice());
    while (positions.length >= armies.length) {
        _.forEach(armies, function(army) {
            if (!positions.length)
                return;
            var position = _.last(positions);
            army.zones.push({
                position: position,
                planet_index: 0,
                radius: landingZones.radius
            });
            positions.pop();
        });
    }
}

exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function(config) {
    _.forEach(config.armies, function(army) {
        army = _.clone(army);
        army.ai = true;
        var armyCreateCheck = sim.armies.length;
        sim.armies.push(army);
        if (armyCreateCheck === sim.armies.length) {
            console.error("Failed creating army", JSON.stringify(army));
            return;
        }
        var simArmy = _.last(sim.armies);
        army.id = simArmy.id;
        client_state.armies.push(army);
        
        armies.push({
            id: simArmy.id,
            sim: simArmy,
            desc: army,
            zones: [],
            commander: army.commander
        });

        if (army.hasOwnProperty('econ_rate'))
            simArmy.econ_rate = army.econ_rate;
    });

    var landingZones = createLandingZones(config);
    assignLandingZones(landingZones);
    
    _.forEach(armies, function(army) {
        var spawn = army.sim.aiSpawnLocation(army.zones);
        army.commander = spawnUnit(army, army.commander, sim.planets[spawn.planet_index], spawn.location);
        army.sim.finalizeEconomy();
    });
    
    sim.paused = !!config.paused;
    
    var defeatTimer = setInterval(tickDefeatState, 1000);
    cleanup.push(function() { clearInterval(defeatTimer); });
    
    if (main.time_limit)
        setTimeout(function() { sim.paused = true; sim.onShutdown = server.exit; sim.shutdown(true); }, main.time_limit * 1000);
    
    function handleNewConnection(client) {
        sim.armies.setVisionBits(client, true);
        sim.armies.setControlBits(client, false);
    }
    
    utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
        updateBeacon();
        
        if (!reconnect)
            handleNewConnection(client);
        return onConnect;
    });
    cleanup.push(function() { server.onConnect.pop(); });
    
    _.forEach(server.clients, handleNewConnection);
    
    server.maxClients = config.hasOwnProperty('maxClients') ? config.maxClients : 16;
    updateBeacon();
    
    return client_state;
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];
    return true;
};

