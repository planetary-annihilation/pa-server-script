var main = require('main');
var sim_utils = require('sim_utils');
var utils = require('utils');
var file = require('file');
var _ = require('thirdparty/lodash');
var ko = require('thirdparty/knockout');

// Note: GW does not currently support reconnect.
var DISCONNECT_TIMEOUT = 0.0; // In ms.

var debugging = false;

function debug_log(object) {
    if (debugging)
        console.log(JSON.stringify(object,null,'\t'));
}

var client_state = {
    control: {}
};

function LobbyModel(creator) {
    var self = this;

    self.control = ko.observable({
        has_config: false,
        starting: false,
        system_ready: false,
        sim_ready: false
    });

    self.config = ko.observable();

    self.creator = creator.id;
    self.creatorReady = ko.observable();
    self.creatorReady.subscribe(function() {
        self.changeControl({starting: true});
    });
    self.creatorDisconnectTimeout = undefined;

    self.clientState = ko.computed(function() {
        if (!_.isEqual(client_state.control, self.control())) {
            client_state.control = self.control();
            server.broadcast({
                message_type: 'control',
                payload: client_state.control
            });
        }
    });

    self.changeControl = function(updateFlags) {
        self.control(_.assign({}, self.control(), updateFlags));
    };

    var getAIName = (function () {

        var ai_names = _.shuffle(require('ai_names_table').data); /* shuffle returns a new collection */

        return function () {
            var name = ai_names.shift();
            ai_names.push(name);
            return name;
        }
    })();
    var addAINames = function(armies) {
        _.forEach(armies, function(army) {
            _.forEach(army.slots, function(slot) {
                if (slot.ai && !slot.name)
                    slot.name = getAIName();
            });
        });
    };

    self.startGame = function() {
        var config = self.config();
        // Point the non-AI slots at the player
        _.forEach(config.armies, function(army) {
            var ai = _.any(army.slots, 'ai');
            if (!ai) {
                _.forEach(army.slots, function(slot) {
                    slot.client = creator;
                });
            }
        });
        // Set up the players array for the landing state
        var players = {};
        players[self.creator] = config.player;

        var landingConfig = {
            game: {
                system: config.system,
                type: 'Galactic War',
                game_options: {
                    game_type: 'Galactic War',
                    sandbox: config.sandbox
                }
            },
            armies: config.armies,
            players: players
        };

        addAINames(landingConfig.armies);

        console.log('final gw_lobby data:');
        var logConfig = _.clone(config);
        delete logConfig.files;
        console.log(JSON.stringify(logConfig, null, '\t'));

        config_summary = _.clone(logConfig);
        var client_names = [];
        _.forEach(config_summary.armies, function (army) {
            _.forEach(army.slots, function (slot) {
                if (slot.client) {
                    client_names.push(slot.client.name);
                }
            });
        });
        config_summary.client_names = client_names.join(" ");

        delete config_summary.player;
        delete config_summary.armies;
        delete config_summary.gw.galaxy;
        delete config_summary.gw.inventory;

        server.setReplayConfig(JSON.stringify(config_summary), JSON.stringify(config));

        main.setState(main.states.landing, landingConfig);
    };

    self.control.subscribe(function(control) {
        if (control.starting && control.system_ready && control.sim_ready)
            self.startGame();
    });

    self.validateConfig = function(config) {
        var systemValidationResult = sim_utils.validateSystemConfig(config.system);
        if (_.isString(systemValidationResult))
            return console.error('GW - Invalid configuration', systemValidationResult) && false;
        else
            return systemValidationResult.then (function() {
                if (!config.player || !config.player.commander)
                    return console.error('GW - Invalid player configuration') && false;

                var hasPlayer = false;
                var hasAI = false;
                var invalidArmy = false;
                var invalidAI = false;

                _.forEach(config.armies, function(army) {
                    invalidArmy |= !_.isArray(army.slots) || army.slots.length === 0;
                    if (!invalidArmy) {
                        var ai = _.any(army.slots, 'ai');
                        hasAI |= ai;
                        hasPlayer |= !ai;
                        if (ai) {
                            invalidAI |= _.any(army.slots, function(slot) {
                                if (!slot.ai)
                                    return true;
                                if (!slot.commander) {
                                    invalidAI = true;
                                    return true;
                                }
                                return false;
                            });
                        }
                    }
                });

                if (invalidAI)
                    return console.error('GW - Invalid AI configuration') && false;

                if (invalidArmy || !hasPlayer || !hasAI)
                    return console.error('GW - Invalid army configuration') && false;

                return true;
            });
    };

    self.config.subscribe(function(newConfig) {
        self.changeControl({
            has_config: true,
            system_ready: false,
            sim_ready: false
        });

        if (newConfig.files) {
            var cookedFiles = _.mapValues(newConfig.files, function(value) {
                if (typeof value !== 'string')
                    return JSON.stringify(value);
                else
                    return value;
            });
            file.mountMemoryFiles(cookedFiles);
        }

        sim.shutdown(false);
        sim.systemName = newConfig.system.name;
        sim.planets = newConfig.system.planets;
    });

    var playerMsg = {
        set_config : function(msg, response) {
            if (self.control().has_config) {
                return response.fail('Configuration already set');
            }

            var validResult = self.validateConfig(msg.payload);
            var validResponse = function(valid) {
                if (valid) {
                    self.config(msg.payload);
                    response.succeed();
                }
                else {
                    response.fail('Invalid configuration');
                    _.delay(function() { server.exit(); });
                }
            }

            if (_.isBoolean(validResult))
                validResponse(validResult);
            else
                validResult.then(validResponse);
        },
        set_ready: function(msg, response) {
            self.creatorReady(true);
            response.succeed();
        }
    };
    playerMsg = _.mapValues(playerMsg, function(handler, key) {
        return function(msg) {
            debug_log('playerMsg.' + key);
            var response = server.respond(msg);
            if (msg.client.id !== self.creator)
                return response.fail("Invalid message");
            return handler(msg, response);
        };
    });

    var cleanup = [];

    self.enter = function() {
        utils.pushCallback(sim.planets, 'onReady', function (onReady) {
            debug_log('sim.planets.onReady');
            sim.create();
            self.changeControl({ system_ready: true });
            return onReady;
        });
        cleanup.push(function () { sim.planets.onReady.pop(); });

        utils.pushCallback(sim, 'onReady', function (onReady) {
            debug_log('sim.onReady');
            self.changeControl({ sim_ready: true });
            return onReady;
        });
        cleanup.push(function () { sim.onReady.pop(); });

        var removeHandlers = server.setHandlers(playerMsg);
        cleanup.push(function () { removeHandlers(); });
    };

    self.exit = function() {
        _.forEachRight(cleanup, function (c) { c(); });
        cleanup = [];
    };

    utils.pushCallback(creator, 'onDisconnect', function(onDisconnect) {
        self.creatorDisconnectTimeout = setTimeout(function() {
            delete self.creatorDisconnectTimeout;
            console.log('GW - Creator timed out');
            server.exit();
        }, DISCONNECT_TIMEOUT);
        return onDisconnect;
    });

    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {
        if (!client.id !== self.creator) {
            server.rejectClient(client, 'GW mode is currently single player');
            return onConnect;
        }

        if (self.creatorDisconnectTimeout) {
            clearTimeout(self.creatorDisconnectTimeout);
            delete self.creatorDisconnectTimeout;
        }

        self.creatorReady(false);
        return onConnect;
    });

    self.shutdown = function() {
        server.onConnect.pop();
    };
};

var lobbyModel;

exports.url = 'coui://ui/main/game/galactic_war/gw_lobby/gw_lobby.html';
exports.enter = function (owner) {

    if (lobbyModel) {
        lobbyModel.shutdown();
        lobbyModel = undefined;
    }

    lobbyModel = new LobbyModel(owner);
    lobbyModel.enter();

    return client_state;
};

exports.exit = function (newState) {
    if (lobbyModel)
        lobbyModel.exit();

    return true;
};

main.gameModes.gw = exports;
