// This is a collection of functions that are shared between different "playing"
// states.  (As of 7/31/2014, playing.js & landing.js)
//
// Import into your global namespace (if desired) via
// _.assign(module, require('states/playing_state').import(module))

var _ = require('thirdparty/lodash');
var sim = require('sim');
var server = require('server');
var main = require('main');

var ALLIANCE_REQUEST_TIMEOUT = 60;

var playerMsg_modDataUpdated = function (msg) {
    _.forEach(server.clients, function (client) {
        if (client.id !== msg.client.id) {
            client.downloadModsFromServer();
        } else {
            client.message({
                message_type: 'mount_mod_file_data',
                payload: {}
            });
        }
    });
};

// Required context interface:
// - armies = armies array
// - players = players array
// - diplomaticStates = diplomatic state per-army for every other army
// - game_options = game options
// - client_state.armies = army state to be transmitted to the clients

exports.import = function(context) {
    var self = context;

    if (!self.game_options)
        self.game_options = {};

    var initClientsVisionAndControl = function () {
        var armyMask = Array(self.armies.length);
        for (var a = 0; a < armyMask.length; ++a)
            armyMask[a] = false;

        _.forEach(server.clients, function (client) {
            var player = self.players[client.id];
            if (!player)
                console.log('{{ERROR}} could not find player with id: ' + client.id);

            var spectate = !player;
            if (!spectate) {

                if (player.army) { /* only absent if we loaded an old replay */
                    var playerArmyIndex = player.army.index;
                    if (playerArmyIndex >= 0) {
                        armyMask[playerArmyIndex] = true;
                        sim.armies.setControlBits(client, armyMask);
                        sim.armies.setVisionBits(client, armyMask);
                        armyMask[playerArmyIndex] = false;
                    }
                    else {
                        console.log('{{ERROR}} bad army index: ' + playerArmyIndex);
                        spectate = true;
                    }
                }
                else {
                    if (self.modifyControlState)
                        self.modifyControlState({ malformed: true });

                    console.log('{{ERROR}} no army. data is malformed.');
                    client.setControlBits(false);
                    client.setVisionBits(true);
                }
            }
            if (spectate) {
                sim.armies.setControlBits(client, false);
                sim.armies.setVisionBits(client, true);
            }
        });
    }

    var playerMsg_trim_history_and_restart = function (msg) {
        var allow = (server.clients.length === 1) || !!self.game_options.sandbox;
        if (!allow)
            return;

        if (self.checkControlState && self.checkControlState('malformed'))
            return;

        if (self.modifyControlState)
            self.modifyControlState({ view_replay: false, restart: true });

        if (self.setPause)
            self.setPause(true);

        initClientsVisionAndControl();
        
        sim.shutdown(false, false);
        sim.onShutdown = function () {
            var time = Number(msg.payload.time);
            if (!time || time < 0)
                return;

            server.trimHistoryAndStartSim(time /* in seconds */);
        };
    };

    var playerMsg_writeReplay = function (msg) {

        var allow_save = (server.clients.length === 1) || !!self.game_options.sandbox;

        if (allow_save && msg.payload.name) {
            if (self.modifyControlState)
                self.modifyControlState({ saving: true });

            if (self.setPause)
                self.setPause(true);

            server.writeReplay(msg.payload.name, msg.payload.type || '');

            /* it would be preferable to hook up a promise interface to the server calls and use .then here... 
               but this is a very minor polish item and this should be sufficient for most cases. 
               the worst thing that could happen is that the player hits the resume game button before the server has finished saving,
               which would just result in a hitch before the game resumed again. */
            /* also, the server will hang here */
            _.delay(function () {
                if (self.modifyControlState)
                    self.modifyControlState({ saving: false });
            }, 2 * 1000);
        }
    };

    var spawnUnit = function (config) {

        var army = config.army && config.army.sim;
        var spec = config.spec;
        var planet = config.planet;
        var position = config.position;
        var orientation = config.orientation;

        var creationCheck = sim.units.length;
        sim.units.push({
            army: army,
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
    };

    var playerMsg_changeControlFlags = function (msg) {

        if (self.checkControlState && self.checkControlState('malformed'))
            return;

        if (!self.game_options.sandbox)
            return;

        var flags = msg.payload.control_flags;
        if (flags)
            sim.armies.setControlBits(msg.client, flags);
    };

    var playerMsg_createUnit = function (msg) {

        if (!self.game_options.sandbox)
            return;

        var desc = msg.payload;
        var army = { sim: sim.armies.getArmy(desc.army) };
        var planet = sim.planets[desc.planet];

        if (army && desc && planet) {
            spawnUnit({
                army: army,
                spec: desc.what,
                planet: planet,
                position: desc.location,
                orientation: desc.orientation
            });
        }
    };

    var playerMsg_changeVisionFlags = function (msg) {

        if (self.checkControlState && self.checkControlState('malformed'))
            return;

        var allow_vision = !!self.game_options.sandbox;
        if (self.players) {
            var player = self.players[msg.client.id];
            var spectator = !player || (player.army && player.army.defeated) || player.has_surrendered;
            if (spectator)
                allow_vision = true;
        }

        if (!allow_vision)
            return;

        var flags = msg.payload.vision_flags;
        if (flags) {
            sim.armies.setVisionBits(msg.client, flags);
            msg.client.message({
                message_type: 'vision_bits',
                payload: sim.armies.getVisionBits(msg.client)
            });
        }
    };

    var playerMsg_changeDiplomaticState = function (msg) {

        var player = self.players[msg.client.id];
        if (!player)
            return;

        var army = player.army.sim;
        var targetArmyId = msg.payload.targetArmyId;
        var state = msg.payload.state;
        if (army && state)
            self.updateDiplomaticState(army, targetArmyId, state);
    };

    return {
        updateArmyState: function (transmit) {
            _.forEach(self.armies, function (army) {
                army.desc.disconnected = 0;
                army.desc.surrendered = 0;
            });

            if (self.players) {
                _.forEach(self.players, function (player) {
                    if (!player.army || !player.army.desc)
                        return;

                    if (player.has_surrendered)
                        ++player.army.desc.surrendered;

                    if (!player.client.connected)
                        ++player.army.desc.disconnected;
                });
            }

            if (transmit) {
                server.broadcast({
                    message_type: 'army_state',
                    payload: self.client_state.armies
                });
            }
        },

        updateConnectionState: function (nextCallback) {
            self.updateArmyState(true);
            return nextCallback;
        },

        spawnUnit: spawnUnit,

        initArmyState: function (config, do_not_add) {
            self.client_state.armies = [];

            var aiCount = 0;
            _.forEach(config.armies, function (army, index) {

                if (!army) /* only absent if we loaded an old replay */
                    return;

                var aiArmy = false;
                function getSlotName(slot) {
                    aiArmy |= !!slot.ai;
                    if (slot.name)
                        return slot.name;
                    if (slot.ai)
                        aiSlotName = "";
                    return slot.name;
                }
                function getSlotCommander(slot) {
                    return slot.commander;
                }
                var name = _.map(army.slots, getSlotName).join(" ");
                army.color = army.color || [[255, 255, 255], [0, 0, 0]];
                var armyDesc = {
                    name: name || "Army",
                    slots: _.map(army.slots, getSlotName),
                    ai: aiArmy,
                    personality: army.personality,
                    primary_color: army.color[0],
                    secondary_color: army.color[1],
                    alliance_group: army.alliance_group,
                    disconnected: 0,
                    surrendered: 0,
                    landing: 0,
                    econ_rate: army.econ_rate,
                    spec_tag: army.spec_tag || '',
                    commanders:  _.map(army.slots, getSlotCommander)
                };
                if (!do_not_add)
                    sim.armies.push(armyDesc);

                var simArmy = sim.armies[index];

                if (do_not_add) /* econ rate is not saved in the history */
                    simArmy.econ_rate = army.econ_rate;

                if (simArmy) { /* only absent if we loaded an old replay */
                    armyDesc.id = simArmy.id;

                    self.client_state.armies.push(armyDesc);
                    var armyState = {
                        id: simArmy.id,
                        index: index,
                        desc: armyDesc,
                        sim: simArmy,
                        ai: _.filter(army.slots, function (slot) { return slot.ai; }),
                        commanders: [],
                        players: [],
                        disconnectAt: null
                    };
                    self.armies.push(armyState);
                }
                else
                    console.log('{{ERROR}} could not find simArmy with index: ' + index);

                _.forEach(army.slots, function (slot) {
                    if (!slot.ai && slot.client) {
                        var client = slot.client;
                        /* sim players are ignored in save/load, otherwise this call would be guarded with if (!do_not_add) */
                        sim.players.push({
                            army: simArmy,
                            client: client
                        });

                        var commander = config.players[client.id].commander;
                        if (!commander)
                            console.log('{{ERROR}} could not find player with id: ' + client.id);

                        var player = {
                            army: armyState,
                            client: client,
                            commander: commander,
                            has_surrendered: false
                        };
                        self.players[client.id] = player;
                        ++armyDesc.landing;
                    }
                    else if (slot.ai)
                        ++aiCount;
                });
                // Get rid of AI-only landing count
                if (!armyDesc.landing)
                    delete armyDesc.landing;
            });

            sim.initAlliances();

            initClientsVisionAndControl();

            _.forEach(self.armies, function (army) {
                var diplomacySet = {};
                _.forEach(self.armies, function (targetArmy) {
                    if (army === targetArmy)
                        return;
                    var state = army.sim.getDiplomaticState(targetArmy.sim.id);
                    var mutable = (army.sim.alliance_group === 0 || army.sim.alliance_group !== targetArmy.sim.alliance_group);
                    diplomacySet[targetArmy.sim.id] = {
                        state: state,
                        allianceRequest: false,
                        mutable: mutable
                    };
                });
                self.diplomaticStates[army.sim.id] = diplomacySet;
            });
            _.forEach(self.client_state.armies, function (army) {
                army.diplomaticState = self.diplomaticStates[army.id];
            });
        },

        updateDiplomaticState: function (army, targetArmyId, state) {
            if (arguments.length !== 3) {
                console.log("updateDiplomaticState given improper number of arguments")
                return;
            }
            var armyId = army.id;
            var targetArmy = _.find(self.armies, function (target) { return target.id === targetArmyId });

            var armyDiplomacy = self.diplomaticStates[armyId][targetArmyId];
            var targetDiplomacy = self.diplomaticStates[targetArmyId][armyId];

            if (!self.game_options.dynamic_alliances
                    || !armyDiplomacy.mutable
                    || army.defeated
                    || targetArmy.defeated)
                return;

            state = state.toLowerCase();
            if (state === "allied") {
                if (armyDiplomacy.state === "allied")
                    return;
                if (armyDiplomacy.state === "allied_eco") {
                    armyDiplomacy.state = "allied";
                    sim.setDiplomaticState(armyId, targetArmyId, "allied");
                }
                else if (targetDiplomacy.allianceRequest) {
                    armyDiplomacy.state = "allied";
                    targetDiplomacy.state = "allied";
                    sim.setDiplomaticState(armyId, targetArmyId, "allied");
                    sim.setDiplomaticState(targetArmyId, armyId, "allied");
                    targetDiplomacy.allianceRequest = 0;
                }
                else if (!armyDiplomacy.allianceRequest) {
                    armyDiplomacy.allianceRequest = 1;
                    setTimeout(function () {
                        armyDiplomacy.allianceRequest = 0;
                        self.updateArmyState(true);
                    }, ALLIANCE_REQUEST_TIMEOUT * 1000);
                }
            } else if (state === "allied_eco") {
                if (armyDiplomacy.state === "allied") {
                    armyDiplomacy.state = "allied_eco";
                    sim.setDiplomaticState(armyId, targetArmyId, "allied_eco");
                }
            } else if (state === "neutral") {
                if (armyDiplomacy.state === "allied") {
                    //break alliance
                    targetDiplomacy.state = "hostile";
                    targetDiplomacy.allianceRequest = 0;
                    sim.setDiplomaticState(targetArmyId, armyId, "hostile");
                }
                armyDiplomacy.state = "neutral";
                sim.setDiplomaticState(armyId, targetArmyId, "neutral");
            } else if (state === "hostile") {
                if (armyDiplomacy.state === "allied"
                    || armyDiplomacy.state === "allied_eco") {
                    //break alliance
                    targetDiplomacy.state = "hostile";
                    targetDiplomacy.allianceRequest = 0;
                    sim.setDiplomaticState(targetArmyId, armyId, "hostile");
                }
                armyDiplomacy.state = "hostile";
                sim.setDiplomaticState(armyId, targetArmyId, "hostile");
            }
            //inform clients of Alliance State changes
            _.forEach(self.client_state.armies, function (army) {
                army.diplomaticState = self.diplomaticStates[army.id];
            });
            self.updateArmyState(true);
        },

        playerMsg_handlers: {
            change_diplomatic_state: playerMsg_changeDiplomaticState,
            change_control_flags: playerMsg_changeControlFlags,
            change_vision_flags: playerMsg_changeVisionFlags,
            create_unit: playerMsg_createUnit,
            mod_data_updated: main.cheats.cheat_flags.allow_mod_data_updates && playerMsg_modDataUpdated,
            trim_history_and_restart: playerMsg_trim_history_and_restart,
            write_replay: playerMsg_writeReplay
        }
    };
};
