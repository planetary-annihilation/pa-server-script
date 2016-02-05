var main = require('main');
var utils = require('utils');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');

function fixupConfig(gameConfig) {
    gameConfig.armies = gameConfig.armies || [];
    gameConfig.units = gameConfig.units || [];
}

function loadConfig(gameConfig) {
    fixupConfig(gameConfig);

    var systemConfig = gameConfig.system;
    sim.planets = systemConfig.planets;
    sim.create();
}

exports.url = 'coui://ui/main/game/live_game/live_game.html';
exports.enter = function() {
    server.maxClients = 0;
    server.beacon = {
        full: true,
        players: 0,
        max_players: 0,
        mode: "Sandbox",
        required_content: content_manager.getRequiredContent(),
    };

    var sandboxConfig = require('sandbox_config').config;
    loadConfig(sandboxConfig);

    var playingState = main.loadState('sandbox_playing');
    if (sim.ready)
        main.setState(playingState, sandboxConfig);
    else {
        utils.pushCallback(sim, 'onReady', function (onReady) {
            sim.onReady.pop();
            main.setState(playingState, sandboxConfig);
            return onReady;
        });
    }
};
