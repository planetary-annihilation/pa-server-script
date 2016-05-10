var main = require('main');
var sim_utils = require('sim_utils');
var utils = require('utils');
var bouncer = require('bouncer');
var env = require('env');
var content_manager = require('content_manager');
var _ = require('thirdparty/lodash');
var watchdog = require('lobby/watchdog');
var commander_manager = require('lobby/commander_manager');
var color_manager = require('lobby/color_manager');

var commanders = new commander_manager.CommanderManager();
var colors = new color_manager.ColorManager();

var DISCONNECT_TIMEOUT = 60.0 * 1000.0; // In ms.
var ABORT_GAME_DELAY = 5.0 * 1000.0; // In ms.
var START_GAME_DELAY = 5; // In s.
var NUM_PLAYERS = 2; /* TODO: Code that uses this needs refactoring for non 1v1 ladder. */
var MAX_SPECTATORS = 6;
var MAX_CLIENTS = NUM_PLAYERS + MAX_SPECTATORS;
var LADDER_GAME_TYPE = 'Ladder1v1';

var no_cheats = {
    cheat_flags: {
        any_enabled: false,
        cheat_mod_enabled: false,
    }
};

var debugging = false;

function debug_log(object) {
    if (debugging)
        console.log(JSON.stringify(object,null,'\t'));
}

var client_state = {
    armies: [],
    players: [],
    colors: [],
    system: {},
    settings: {},
    control: {}
};

function PlayerModel(client, options) {
    var self = this;

    self.client = client; /* data, debugDesc, connected, id, name */
    try {
        self.client_data = JSON.parse(client.data);
    } catch (error) {
        debug_log("Unable to parse client data for player");
        debug_log(error);
        self.client_data = {};
    }

    self.spectator = false;

    self.commander = commanders.getRandomDefaultCommanderSpec();

    self.loading = true;

    self.armyIndex = -1;
    self.slotIndex = -1;

    self.colorIndex = colors.takeRandomAvailableColor();

    self.nextPrimaryColorIndex = function () {
        var primary = colors.takeNextAvailableColorIndex(self.colorIndex[0]);
        self.returnColorIndex();
        self.colorIndex = [primary, colors.getRandomSecondaryColorIndexFor(primary)];
    };

    self.nextSecondaryColorIndex = function () {
        self.colorIndex[1] = colors.getNextSecondaryColorIndexFor(self.colorIndex[0], self.colorIndex[1]);
    }

    self.clearColorIndex = function () {
        self.returnColorIndex();
        self.colorIndex = [-1, -1];
    };

    self.maybeTakeColorIndex = function () {
        if (self.colorIndex[0] !== -1)
            return;
        self.colorIndex = [colors.takeRandomAvailableColorIndex(), 0];
    };

    self.setPrimaryColorIndex = function (index) {
        var primary = colors.maybeGetNewColorIndex(self.colorIndex[0], index);
        var secondary = self.colorIndex[1];
        if (!colors.isValidColorPair(primary, secondary)) {
            secondary = colors.getRandomSecondaryColorIndexFor(primary);
        }
        self.colorIndex = [primary, secondary];
    };

    self.setSecondaryColorIndex = function (index) {
        self.colorIndex = [self.colorIndex[0], index];
    };

    self.adjustArmyIndexAboveTarget = function (target_index, delta) {
        if (self.armyIndex > target_index)
            self.armyIndex += delta;
    };

    self.adjustSlotIndexAboveTarget = function (target_index, delta) {
        if (self.slotIndex > target_index)
            self.slotIndex += delta;
    };

    self.processRemoveIndex = function (target_index) {
        if (self.armyIndex === target_index) {
            self.armyIndex = -1;
            self.slotIndex = -1;
        }
        else
            self.adjustArmyIndexAboveTarget(target_index, -1);
    };

    self.processRemoveSlotAtIndex = function (target_index, target_slot) {
        if (self.armyIndex === target_index) {

            if (self.slotIndex === target_slot) {
                self.armyIndex = -1;
                self.slotIndex = -1;
            }
            else
                self.adjustSlotIndexAboveTarget(target_slot, -1);
        }
    };

    self.asJson = function () {
        return {
            name: self.client.name,
            id: self.client.id,
            connected: self.client.connected,
            army_index: self.armyIndex,
            slot_index: self.slotIndex,
            commander: self.commander,
            loading: self.loading,
            color: colors.getColorFor(self.colorIndex),
            color_index: self.colorIndex[0]
        };
    };

    self.maybeTakeColorIndex = function () {
        if (self.colorIndex[0] === -1)
            self.colorIndex = [colors.takeRandomAvailableColorIndex(), 0];
    };

    self.returnColorIndex = function () {
        if (self.colorIndex[0] === -1)
            return;

        colors.returnColorIndex(self.colorIndex[0]);
        self.colorIndex = [-1, -1];
    };

    self.finalize = function () {
        return {
            'name': self.client.name,
            'commander': self.commander,
            'client': self.client,
            'army': self.armyIndex,
            'slot': self.slotIndex,
            'ai': false
        };
    };

    self.setCommander = function (new_commander) {
        if (!new_commander || self.commander === new_commander)
            return;

        var commanderObject = commanders.getCommanderObjectName(new_commander);
        if (!commanderObject) {
            debug_log("Failed to locate item " + (new_commander));
            return;
        }

        if (!self.client.validateItem(commanderObject)) {
            debug_log("Failed to validate ownership of " + (commanderObject));
            return;
        }

        self.commander = new_commander;

        lobbyModel.updatePlayerState();
    }

    self.setDisconnectTimeout = function(whenDisconnect, whenTimeout) {
        utils.pushCallback(self.client, 'onDisconnect', function(onDisconnect) {
            self.timeout = setTimeout(function() {
                delete self.timeout;
                whenTimeout();
            }, DISCONNECT_TIMEOUT);
            whenDisconnect();
            return onDisconnect;
        });
    };
    self.clearDisconnectTimeout = function() {
        if (!self.hasOwnProperty('timeout'))
            return;
        clearTimeout(self.timeout);
        delete self.timeout;
    };
};

function ArmyModel(options) {
    var self = this;

    self.slots = options.slots ? Math.max(options.slots, 1) : 1;
    self.alliance = true;
    self.allianceGroup = 0; /* 0 indicates no alliance */

    self.asJson = function () {
        return {
            slots: self.slots,
            alliance: self.alliance
        };
    };

    self.finalizeAsConfig = function () {
        var s = [];
        s.length = self.slots;

        _.forEach(s, function (element, index) {
            s[index] = 'player';
        });

        return {
            slots: s,
            alliance_group: self.allianceGroup
        };
    };
};

function LobbyModel() {
    var self = this;

    self.maxNumberOfAllowedPlayers = 1;
    self.players = {};
    self.armies = [];
    self.system = {};
    self.minimalSystemDescription = {}; /* system sans custom planet source */
    self.config = {};
    self.settings = {
        spectators: MAX_SPECTATORS,
        hidden: false,
        friends: false,
        public: true,
        tag: "Ladder",
        game_name: "Ladder 1v1 Game",
        required_content: content_manager.getRequiredContent(),
        game_options: {
            dynamic_alliances: false,
            dynamic_alliance_victory: false,
            bounty_mode: false,
            bounty_value: 0.0,
            sandbox: false,
            listen_to_spectators: false,
            game_type: LADDER_GAME_TYPE,
            land_anywhere: false,
        }
    };
    self.control = {}; /* has_first_config starting system_ready sim_ready */

    self.abandonGame = _.once(function(apply_penalty, abandoning_clients, remaining_clients) {
        server.markLadderGameAbandoned(apply_penalty, abandoning_clients, remaining_clients, content_manager.getMatchmakingType());
        server.broadcast({
            message_type: 'event_message',
            payload: {
                'target': '',
                'type': 'abandonment',
                'message': ABORT_GAME_DELAY
            }
        });
    });

    self.abortGame = function() {
        sim.shutdown(false);
        server.exit();
    };

    self.ladderArmies = null;
    var watchdog_options = {
        lobby_model: self,
        start_game_callback: function() {
            server.broadcastEventMessage('', 'Game is starting.');
            self.changeControl({ starting: true });
            maybeStartLandingState();
        },
        abandon_game_callback: self.abandonGame,
        abort_game_callback: self.abortGame,
        shutdown_delay: ABORT_GAME_DELAY
    };
    self.watchdog = new watchdog.LadderLobbyWatchdog(watchdog_options);

    self.dirty = {};
    self.allDirty = {
        control: true,
        system: true,
        players: true,
        armies: true,
        color: true,
        settings: true,
        beacon: true
    };
    // These dirty flags (on the left) will be set when the associated flags (on the right) are set
    self.chainDirty = {
        beacon: ['players', 'armies', 'system', 'settings'],
        color: ['players']
    };

    // Set a given flag to "dirty" (e.g. self.setDirty({control: true}); )
    self.setDirty = function(flags) {
        var needsApply = _.isEmpty(self.dirty);
        _.assign(self.dirty, flags);

        while (!function() {
            return _.all(self.chainDirty, function(flags, key) {
                if (self.dirty[key])
                    return true;
                var chain = _.pick(self.dirty, flags);
                if (_.isEmpty(chain))
                    return true;
                self.dirty[key] = true;
                return false;
            });
        }());

        if (needsApply)
            _.delay(function() { self.cleanDirtyFlags(); });
    };

    // Custom functions for cleaning dirty flags.  (broadcast to client for all other flags)
    self.customCleaners = {
        beacon: function () { self.updateBeacon(); }
    };

    // Clean all the dirty flags
    self.cleanDirtyFlags = function () {
        try {
            _.forIn(self.dirty, function(yes, key) {
                if (self.customCleaners.hasOwnProperty(key))
                    self.customCleaners[key]();
                else {
                    server.broadcast({
                        message_type: key,
                        payload: client_state[key]
                    });
                }
            });
        }
        catch (e) {
            // Note: Very important that the server "mostly" works if this happens.
            console.error('Lobby unable to clean dirty flags:', e.toString());
        }
        self.dirty = {};
    };

    self.playersInArmy = function(army_index) {
        return _.filter(_.values(self.players), function (element){
            return element.armyIndex === army_index;
        });
    };

    self.totalCurrentPlayers = function () {
        var total = 0;
        _.forEach(self.armies, function (element, index) {
            total += self.playersInArmy(index).length;
        });
        return total;
    };

    self.finalizeConfig = function () {
        return {
            "armies": _.invoke(self.armies, 'finalizeAsConfig'),
            "system": self.system,
            "enable_lan": true,
            "spectators": 0,
            "password": "",
            "friends": [],
            "blocked": [],
            "public": true,
            "players": self.totalCurrentPlayers(),
            "vs_ai": false,
            "game_options": self.settings.game_options
        };
    }

    self.finalizePlayers = function () {
        var result = {};

        _.forIn(self.players, function (value, key) {
            result[key] = value.finalize()
        });

        return result;
    };

    self.finalizeArmies = function () {
        var result = _.invoke(self.armies, 'finalizeAsConfig');

        _.forIn(self.players, function (element) {
            var army = result[element.armyIndex];
            if (!army) /* player is spectating */
                return;

            army.slots[element.slotIndex] = element.finalize(); /* insert finalized block { name, commander, client, army, ai } */

            if (element.slotIndex === 0) { /* only use the color for the first player in the army */
                result[element.armyIndex].color = colors.getColorFor(element.colorIndex); /* insert expanded color */
                result[element.armyIndex].color_index = element.colorIndex[0];
                result[element.armyIndex].econ_rate = 1.0;
            }
        });

        return result;
    }

    self.getFinalData = function () {
        // TODO: For NvN we need to split up self.armies into
        // one army per player, and set the alliance groups properly.
        // Similar, but simpler, than breakArmyIntoAlliances in lobby.js.
        _.invoke(self.players, 'maybeTakeColorIndex');

        return {
            game: lobbyModel.finalizeConfig(),
            armies: lobbyModel.finalizeArmies(),
            players: lobbyModel.finalizePlayers(),
            ranked: true
        }
    };

    self.updatePlayerState = function () {
        debug_log('updatePlayerState');
        var players = _.invoke(self.players, 'asJson');
        if (_.isEqual(client_state.players, players))
            return;
        client_state.players = _.cloneDeep(players);
        self.setDirty({players: true});

        self.watchdog.updatePlayerState();
    };

    self.updateArmyState = function () {
        debug_log('updateArmyState');
        var armies = _.invoke(self.armies, 'asJson');
        if (_.isEqual(client_state.armies, armies))
            return;
        client_state.armies = _.cloneDeep(armies);
        self.setDirty({ armies: true });
    };

    self.updateSystemState = function () {
        debug_log('updateSystemState');
        if (_.isEqual(client_state.system, self.system))
            return;
        client_state.system = _.cloneDeep(self.system);
        self.setDirty({system: true});
    };

    self.changeSystem = function (system) {
        if (_.isEqual(system, self.system))
            return;

        self.changeControl({ system_ready: false, sim_ready: false });
        self.system = system;

        self.minimalSystemDescription = utils.getMinimalSystemDescription(self.system);

        self.updateSystemState();

        /* this will take some time.  the server will be unresponsive. */
        sim.shutdown(false);
        sim.systemName = lobbyModel.system.name;
        sim.planets = self.system.planets;
    };

    self.updateColorState = function () {
        debug_log('updateColorState');
        if (_.isEqual(client_state.colors, colors.colors))
            return;
        client_state.colors = _.cloneDeep(colors.colors);
        self.setDirty({colors: true});
    };

    self.updateControlState = function () {
        debug_log('updateControlState');
        if (_.isEqual(client_state.control, self.control))
            return;
        client_state.control = _.cloneDeep(self.control);
        self.setDirty({control: true});
    };

    self.changeControl = function (control /* has_first_config starting system_ready sim_ready */) {
        _.assign(self.control, control);
        self.updateControlState();
    };

    self.updateSettingsState = function () {
        debug_log('updateSettingsState');
        if (_.isEqual(client_state.settings, self.settings))
            return;
        client_state.settings = _.cloneDeep(self.settings);

        main.spectators = Number(self.settings.spectators);

        self.setDirty({ settings: true });
    };

    self.updateClientState = function () {
        debug_log('updateClientState');
        self.updatePlayerState();
        self.updateArmyState();
        self.updateSystemState();
        self.updateColorState();
        self.updateControlState();
        self.updateSettingsState();
    };

    self.addPlayersToSlotsIfPossible = function () {
        debug_log('addPlayersToSlotsIfPossible');

        var army_index = 0;
        _.forIn(self.players, function (element, key) {

            if (element.armyIndex !== -1 || element.spectator)
                return;

            while (army_index < self.armies.length)
            {
                if (self.addPlayerToArmy(key, army_index))
                    break;
                army_index += 1;
            }
        });
    }

    self.removeArmy = function (army_index) {
        var spares = [];

        if (self.ladderArmies && army_index < self.ladderArmies.length)
            return;

        self.armies.splice(army_index, 1);

        _.invoke(self.players, 'processRemoveIndex', army_index);

        self.addPlayersToSlotsIfPossible();
        self.updateArmyState();
        self.updatePlayerState();
    };

    self.numPlayers = function () {
        return _.keys(self.players).length;
    };

    self.updateBeacon = function () {
        if (self.settings.hidden) {
            server.beacon = null;
            return;
        }

        debug_log('updateBeacon');
        var numPlayers = self.totalCurrentPlayers();
        server.maxClients = NUM_PLAYERS + Math.min(MAX_SPECTATORS, main.spectators);
        var full = server.clients.length >= server.maxClients;

        var modsData = server.getModsForBeacon();

        var player_names = _.map(_.filter(self.players, { 'spectator': false }), function (player) { return player.client.name; });
        var spectator_names = _.map(_.filter(self.players, { 'spectator': true }), function (player) { return player.client.name; });

        server.beacon = {
            full: full,
            started: self.control.countdown || self.control.starting,
            players: player_names.length,
            creator: "Planetary Annihilation",
            max_players: NUM_PLAYERS,
            spectators: spectator_names.length,
            max_spectators: main.spectators,
            mode: self.settings.game_options.game_type,
            mod_names: modsData.names,
            mod_identifiers: modsData.identifiers,
            cheat_config: no_cheats,
            player_names: player_names,
            spectator_names: spectator_names,
            require_password: !!bouncer.doesGameRequirePassword(),
            whitelist: bouncer.getWhitelist(),
            blacklist: bouncer.getBlacklist(),
            tag: self.settings.tag,
            game: {
                system: self.minimalSystemDescription,
                name: self.settings.game_name
            },
            required_content: content_manager.getRequiredContent(),
            bounty_mode: !!self.settings.game_options.bounty_mode,
            bounty_value: self.settings.game_options.bounty_value,
            sandbox: !!self.settings.game_options.sandbox
        };
    };

    self.addPlayer = function (client, options) {
        debug_log('addPlayer');
        var player = new PlayerModel(client, options);
        self.players[client.id] = player;
        self.updatePlayerState();
        self.updateColorState();

        _.delay(server.broadcastEventMessage, 500, player.client.name, ' joined the lobby.');

        debug_log('Player Stats: ');
        debug_log(player.client.statistics);
        client.incrementStatistic("TestStat_LobbiesJoined", 1);

        if (!player.hasOwnProperty('cleanupTicket')) {
            player.setDisconnectTimeout(
                function() { self.updatePlayerState(); },
                function() { self.removePlayer(client.id); }
            );
            cleanup.push(function() {
                player.clearDisconnectTimeout();
                client.onDisconnect.pop();
            });
            player.cleanupTicket = cleanup.length - 1;
        }
    };

    self.reconnectPlayer = function (client) {
        var player = self.players[client.id];
        // If they came back, don't time them out.
        player.clearDisconnectTimeout();
        self.updatePlayerState();
    };

    self.removePlayer = function (id, options) {
        debug_log('removePlayer');

        delete client_state.players[id];
        var player = self.players[id];

        // If someone voluntarily leaves, and they're one of the ladder ranked players
        // that we're expecting in this match, abandon the whole shebang.
        var uberid = player.client_data.uberid;
        if (options && options.voluntary && uberid) {
            var ladderPlayers = _.flatten(self.ladderArmies);
            if (_.contains(ladderPlayers, uberid)) {
                var remaining = _.filter(ladderPlayers, function(u) { return u !== uberid; });
                self.abandonGame(true, [uberid], remaining);
                _.delay(self.abortGame, ABORT_GAME_DELAY);
            }
        }

        if (player) {

            self.removePlayerFromArmy(id, { clear_color: true });

            server.broadcastEventMessage(player.client.name, ' has left the lobby.');

            player.returnColorIndex();
            delete self.players[id];

            if (player.hasOwnProperty('cleanupTicket')) {
                // Run the player's clean up handling now.
                cleanup[player.cleanupTicket]();
                cleanup[player.cleanupTicket] = function() {};
                delete player.cleanupTicket;
            }

            player.client.kill();

            self.updatePlayerState();
            self.updateColorState();
        }
    };

    self.addPlayerToArmy = function (player_id, army_index) {
        debug_log('addPlayerToArmy');
        var player = self.players[player_id];
        var army = self.armies[army_index];

        var array = self.playersInArmy(army_index);
        var count = array.length;

        if (!player || !army || count >= army.slots)
            return false;

        if (player.armyIndex === army_index)
            return false;

        if (!player.client_data.uberid)
            return false;
        if (army_index >= self.ladderArmies.length)
            return false;
        var ladderArmy = self.ladderArmies[army_index];
        if (ladderArmy.indexOf(player.client_data.uberid) < 0)
            return false;

        player.armyIndex = army_index;
        player.slotIndex = count;
        player.spectator = false;

        self.fixColors();

        self.updatePlayerState();
        self.updateArmyState();
        self.updateColorState();
        return true;
    };

    self.removePlayerFromArmy = function (player_id, options) {
        debug_log('removePlayerFromArmy');
        var player = self.players[player_id];

        if (!player)
            return false;

        var move_player_to_army_index = null;
        if (player.client_data.uberid) {
            for (var army_index = 0; army_index < self.ladderArmies.length; ++army_index) {
                var ladderArmy = self.ladderArmies[army_index];
                if (ladderArmy.indexOf(player.client_data.uberid) >= 0) {
                    if (player.armyIndex != army_index) {
                        /* If they're supposed to be a member of an army, but not this one, then proceed to remove them
                         * from this army as per usual, and then add them to the army they're *supposed* to
                         * be a member of.
                         */
                        move_player_to_army_index = army_index;
                        break;
                    } else {
                        /* Otherwise, just disallow their removal. */
                        return false;
                    }
                }
            }
        }

        if (options && options.clear_color)
            player.clearColorIndex();

        var army_index = player.armyIndex;
        var slot_index = player.slotIndex;

        player.armyIndex = -1;
        player.slotIndex = -1;

        if (options && options.set_spectator)
            player.spectator = true;

        /* move players down to fill empty slot */
        _.invoke(self.players, 'processRemoveSlotAtIndex', army_index, slot_index);

        self.fixColors();

        self.updatePlayerState();
        self.updateArmyState();
        self.updateColorState();

        if (move_player_to_army_index != null)
            self.addPlayerToArmy(player_id, move_player_to_army_index);

        return true;
    }

    /* this checks every army, which is excessive; however, it is very reliable. */
    self.fixColors = function () {
        _.forEach(self.armies, function (element, index) {
            self.fixColorsForArmy(index);
        });
    }

    /* it would be preferrable to just call this function for each modified army */
    self.fixColorsForArmy = function (army_index) {

        var army = self.armies[army_index];

        if (!army)
            return;

        _.invoke(self.playersInArmy(army_index), 'maybeTakeColorIndex');

        self.setDirty({ colors: true });
    };

    self.nextPrimaryColor = function (player_id) {
        debug_log('nextPrimaryColor');
        var player = self.players[player_id];

        if (!player)
            return;

        player.nextPrimaryColorIndex();

        self.updatePlayerState();
        self.updateColorState();
    };

    self.nextSecondaryColor = function (player_id) {
        debug_log('nextSecondaryColor');
        var player = self.players[player_id];

        if (!player)
            return;

        player.nextSecondaryColorIndex();

        self.updatePlayerState();
        self.updateColorState();
    };

    self.setPrimaryColorIndex = function (player_id, index) {
        debug_log('setPrimaryColorIndex');
        var player = self.players[player_id];

        if (!player)
            return;

        player.setPrimaryColorIndex(index);

        self.updatePlayerState();
        self.updateColorState();
    };

    self.setSecondaryColorIndex = function (player_id, index) {
        debug_log('setSecondaryColorIndex: ' + index);
        var player = self.players[player_id];

        if (!player)
            return;

        player.setSecondaryColorIndex(index);

        self.updatePlayerState();
        self.updateColorState();
    };

    self.setLadderArmies = function(mode, armies) {
        if (!self.settings.game_options)
            self.settings.game_options = {};
        self.settings.game_options.game_type = mode;
        self.settings.hidden = false;
        self.settings.public = true;
        self.updateSettingsState();

        self.ladderArmies = armies;

        while (self.armies.length > 0)
            self.removeArmy(0);

        for (var i = 0; i < self.ladderArmies.length; ++i) {
            options = {slots: self.ladderArmies[self.armies.length].length};
            self.armies.push(new ArmyModel(options));
        }

        self.updateArmyState();
        self.addPlayersToSlotsIfPossible();

        var watchdogCleanup = self.watchdog.setupWatchdog(START_GAME_DELAY);
        if (watchdogCleanup)
            cleanup.push(watchdogCleanup);

        updateBouncer();
    };
};

var lobbyModel;

var cleanup = [];
var cleanupOnEntry = [];

function updateBouncer() {
    bouncer.setPassword("");
    bouncer.clearWhitelist();
    _.forEach(_.flatten(lobbyModel.ladderArmies), function (element) { bouncer.addPlayerToWhitelist(element); });
    bouncer.clearBlacklist();
}

function maybeStartLandingState() {
    debug_log('maybeStartLandingState');
    if (!lobbyModel.control.starting || !lobbyModel.control.system_ready || !lobbyModel.control.sim_ready)
        return;

    lobbyModel.updateClientState();

    var final_data = lobbyModel.getFinalData();

    try {
        console.log('final lobby data:');
        console.log(JSON.stringify(final_data, null, '\t'));
    }
    catch (e) {
        console.log('final lobby data: failed.'); // this is *not* expected.
    };

    main.setState(main.states.landing, final_data);
}

function playerMsg_nextPrimaryColor(msg) {
    debug_log('playerMsg_nextPrimaryColor');
    var response = server.respond(msg);
    lobbyModel.nextPrimaryColor(msg.client.id);
    response.succeed();
}

function playerMsg_nextSecondaryColor(msg) {
    debug_log('playerMsg_nextSecondaryColor');
    var response = server.respond(msg);
    lobbyModel.nextSecondaryColor(msg.client.id);
    response.succeed();
}

function playerMsg_setPrimaryColorIndex(msg) {
    debug_log('playerMsg_setPrimaryColorIndex');
    var response = server.respond(msg);

    lobbyModel.setPrimaryColorIndex(msg.client.id, msg.payload);
    response.succeed();
}

function playerMsg_setSecondaryColorIndex(msg) {
    debug_log('playerMsg_setSecondaryColorIndex');
    var response = server.respond(msg);

    lobbyModel.setSecondaryColorIndex(msg.client.id, msg.payload, false);
    response.succeed();
}

function playerMsg_updateCommander(msg) {
    debug_log('playerMsg_updateCommander');
    var response = server.respond(msg);
    var player = lobbyModel.players[msg.client.id];

    if (!msg.payload || !msg.payload.commander || !player)
        return response.fail("Invalid message");

    player.setCommander(msg.payload.commander);

    return response.succeed();
}

function playerMsg_chatMessage(msg) {
    debug_log('playerMsg_chatMessage');
    var response = server.respond(msg);
    if (!msg.payload || !msg.payload.message)
        return response.fail("Invalid message");
    server.broadcast({
        message_type: 'chat_message',
        payload: {
            player_name: msg.client.name,
            message: msg.payload.message
        }
    });
    response.succeed();
}

function playerMsg_leave(msg) {
    debug_log('playerMsg_leave');
    var response = server.respond(msg);

    lobbyModel.removePlayer(msg.client.id, {voluntary: true});

    response.succeed();
}

function playerMsg_setLoading(msg) {
    debug_log('playerMsg_setLoading');

    var response = server.respond(msg);
    var player = lobbyModel.players[msg.client.id];

    if (!player)
        return response.fail("Invalid message");

    player.loading = msg.payload.loading;

    lobbyModel.updatePlayerState();

    response.succeed();
}

exports.url = 'coui://ui/main/game/new_game/new_game_ladder.html';
exports.enter = function (owner) {

    _.forEachRight(cleanupOnEntry, function (c) { c(); });

    lobbyModel = new LobbyModel();
    cleanupOnEntry.push(function () { lobbyModel = undefined; });

    lobbyModel.changeControl({ has_first_config: false, countdown: false, starting: false, system_ready: false, sim_ready: false });

    utils.pushCallback(sim.planets, 'onReady', function (onReady) {
        debug_log('sim.planets.onReady');
        lobbyModel.changeControl({ system_ready: true });
        sim.create();
        maybeStartLandingState();
        return onReady;
    });
    cleanup.push(function () { sim.planets.onReady.pop(); });

    utils.pushCallback(sim, 'onReady', function (onReady) {
        debug_log('sim.onReady');
        lobbyModel.changeControl({ sim_ready: true });
        maybeStartLandingState();
        return onReady;
    });
    cleanup.push(function () { sim.onReady.pop(); });

    utils.pushCallback(server, 'onConnect', function (onConnect, client, reconnect) {
        debug_log('onConnect');
        var client_data = { uberid: '', password: '', uuid: '' };
        try {
            client_data = JSON.parse(client.data);
            debug_log(client);
        }
        catch (e) {
            debug_log('js utils.pushCallback : unable to parse client.data');
            server.rejectClient(client, 'Bad Client data');
            return onConnect;
        }

        if (!bouncer.isPlayerValid(client_data.uberid, client_data.password, client_data.uuid, lobbyModel.settings.public)) {
            debug_log('invalid credentials');
            server.rejectClient(client, 'Credentials are invalid');
            return onConnect;
        }

        if (!reconnect) {
            var max = Math.min(MAX_CLIENTS, NUM_PLAYERS + main.spectators);
            if (lobbyModel.numPlayers() >= max) {
                debug_log('no room!');
                server.rejectClient(client, 'No room');
                return onConnect;
            }
        }

        if (!lobbyModel.players.hasOwnProperty(client.id))
            lobbyModel.addPlayer(client);
        else
            lobbyModel.reconnectPlayer(client);

        lobbyModel.addPlayersToSlotsIfPossible();

        var player = lobbyModel.players[client.id];
        if (player.armyIndex === -1) /* make the player a spectator if there is no room */
            player.spectator = true;

        debug_log('calling client.downloadModsFromServer');
        client.downloadModsFromServer();

        client.message({
            message_type: 'set_cheat_config',
            payload: no_cheats
        });

        return onConnect;
    });
    cleanupOnEntry.push(function () { server.onConnect.pop(); });

    _.forEach(server.clients, function (client) {
        lobbyModel.addPlayer(client)
    });

    var ladderArmies = null;
    var uberIdsIndex = env.indexOf('--player-uberids');
    if (uberIdsIndex >= 0 && env.length >= uberIdsIndex + 1) {
        var uberIds = env[uberIdsIndex + 1].split(',');
        if (uberIds.length == 2)
            ladderArmies = [[uberIds[0]], [uberIds[1]]];
    }

    if (!ladderArmies) {
        console.error("--player-uberids does not have an appropriate number of players for the specified ladder mode.");
        sim.shutdown(false);
        server.exit();
    }
    else
    {
        lobbyModel.setLadderArmies(main.gameMode, ladderArmies);
        var system = (function() {
            var ladderSystems = require('lobby/ladder_systems_table').data;
            return _.cloneDeep(_.sample(ladderSystems));
        })();

        var systemValidationResult = sim_utils.validateSystemConfig(system);
        if (_.isString(systemValidationResult)) {
            console.error('Invalid random system for 1v1 ladder: ' + systemValidationResult);
            console.error(JSON.stringify(system, null, '\t'));
            sim.shutdown(false);
            server.exit();
        } else {
            systemValidationResult.then(function () { lobbyModel.changeSystem(system); });
        }

        var removeHandlers = server.setHandlers({
            next_primary_color: playerMsg_nextPrimaryColor,
            next_secondary_color: playerMsg_nextSecondaryColor,
            set_primary_color_index: playerMsg_setPrimaryColorIndex,
            set_secondary_color_index: playerMsg_setSecondaryColorIndex,
            update_commander: playerMsg_updateCommander,
            chat_message: playerMsg_chatMessage,
            leave: playerMsg_leave,
            set_loading: playerMsg_setLoading,
        });
        cleanup.push(function () { removeHandlers(); });

        lobbyModel.updateBeacon();
    }

    return client_state;
};

exports.exit = function (newState) {
    _.forEachRight(cleanup, function (c) { c(); });
    cleanup = [];

    return true;
};

main.gameModes.Ladder1v1 = exports;
