var main = require('main');
var sim_utils = require('sim_utils');
var utils = require('utils');
var bouncer = require('bouncer');
var _ = require('thirdparty/lodash');

var cleanup = [];

exports.url = 'coui://ui/main/game/new_game/new_game.html';
exports.enter = function(owner) {
    server.maxClients = 1;
    server.beacon = undefined;

    if (!owner) {
        var testConfig = _.cloneDeep(require('test').exampleConfig);
        main.setState(main.states.lobby, testConfig);
        return;
    }

    bouncer.addPlayerToModlist(owner.id);

    server.handlers.game_config = function(msg) {
        var gameConfig = msg.payload;
        var response = server.respond(msg);

        if (!gameConfig.system)
        {
            response.fail("Invalid game configuration received: No system.");
            return;
        }

        var ret = sim_utils.validateSystemConfig(gameConfig.system);
        if (_.isString(ret))
        {
            response.fail("Invalid game configuration received: " + ret);
            return;
        }
        else
            ret.then(function() {
                response.succeed();

                main.setState(main.states.lobby, gameConfig);
            });
    };
    cleanup.push(function() { delete server.handlers.game_config; });

    utils.pushCallback(server, 'onConnect', function(onConnect, newClient, reconnect) {
        if (newClient !== owner)
            server.rejectClient(newClient, "Server being configured");
        return onConnect;
    });
    cleanup.push(function() { server.onConnect.pop(); });

    if (!main.keep_alive) {
        utils.pushCallback(owner, 'onDisconnect', function(onDisconnect) {
            server.exit();
            return onDisconnect;
        });
        cleanup.push(function() { owner.onDisconnect.pop(); });
    }
};

exports.exit = function(newState) {
    _.forEachRight(cleanup, function(c) { c(); });
    cleanup = [];

    return true;
};
