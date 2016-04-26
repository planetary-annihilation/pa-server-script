var main = require('main');
var sim_utils = require('sim_utils');
var server_utils = require('server_utils');
var content_manager = require('content_manager');
var utils = require('utils');
var bouncer = require('bouncer');
var env = require('env');
var _ = require('thirdparty/lodash');
var commander_manager = require('lobby/commander_manager');
var color_manager = require('lobby/color_manager');

var SERVER_PASSWORD = main.SERVER_PASSWORD;

var getAIName = (function () {

    var ai_names = _.shuffle(require('ai_names_table').data); /* shuffle returns a new collection */

    return function () {
        var name = ai_names.shift();
        ai_names.push(name);
        return name;
    }
})();

var used_ai_ids = [];
var last_ai_number = 0;

var getAIId = function () {
    if (used_ai_ids.length)
        return used_ai_ids.pop();
    else {
        last_ai_number++;
        return '' + last_ai_number;
    }
}

var returnAIId = function (id) {
    used_ai_ids.push(id);
}

var commanders = new commander_manager.CommanderManager();
var colors = new color_manager.ColorManager();

var START_GAME_DELAY = 5; // In s.
var MAX_PLAYERS = main.MAX_PLAYERS;
var MAX_SPECTATORS = main.MAX_SPECTATORS;
var MAX_CLIENTS = MAX_PLAYERS + MAX_SPECTATORS;
var DEFAULT_LOBBY_TAG = '';
var DEFAULT_LOBBY_NAME = main.DEFAULT_LOBBY_NAME;
var DEFAULT_GAME_TYPE = main.DEFAULT_GAME_TYPE;
var VALID_GAME_TYPES = ['FreeForAll', 'TeamArmies', 'VersusAI'];
var isValidGameType = function (game_type) {
    return VALID_GAME_TYPES.indexOf(game_type) != -1;
};

if (!isValidGameType(DEFAULT_GAME_TYPE)) {
    DEFAULT_GAME_TYPE = VALID_GAME_TYPES[0];
}

var isFFAType = function (game_type) {
    return game_type === 'FreeForAll';
};

var DEFAULT_GAME_OPTIONS = {
    dynamic_alliances: false,
    dynamic_alliance_victory: false,
    bounty_mode: false,
    bounty_value: 0.5,
    sandbox: false,
    listen_to_spectators: false,
    game_type: DEFAULT_GAME_TYPE,
    land_anywhere: false,
};


var alliance_groups = _.range(1, MAX_CLIENTS / 2 + 1); /* 0 indicates no alliance */

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

/* the lobby stays up after we transition out of the state, so that it can handle login/rejoin attempts
   if a player leaves the lobby, we kill the client (but they can still rejoin); however, if a player
   leaves after the game has moved on to another state (usually due to a disconnect error),
   we don't want to kill the client, since the playing state will setup a disconnect timer. */
var hasStartedPlaying = false;

var MAX_LOBBY_CHAT_HISTORY = 100;

var lobbyChatHistory = [];

function PlayerModel(client, options) {
    var self = this;

    self.client = client; /* data, debugDesc, connected, id, name */
    try {
        self.client_data = JSON.parse(client.data);

        // add uberId for custom servers
        client.uberid = client_data.uberid;
    } catch (error) {
        debug_log("Unable to parse client data for player");
        debug_log(error);
        self.client_data = null;
    }
    self.creator = !!options.creator;
    self.spectator = !!options.spectator;

    self.ai = !!options.ai;
    self.personality = options.personality || '';

    /* for now, only AI have landing policy. values: ['no_restriction', 'on_player_planet', 'off_player_planet'] */
    self.landingPolicy = (self.ai && options.landing_policy) ? options.landing_policy  : 'no_restriction';

    self.commander = commanders.getRandomDefaultCommanderSpec();

    self.ready = self.ai ? true : false;
    self.loading = self.ai ? false : true;

    self.armyIndex = -1;
    self.slotIndex = -1;

    self.colorIndex = (self.ai || self.spectator) ? [-1, -1] : colors.takeRandomAvailableColor();

    self.economyFactor = _.isFinite(options.economy_factor) ? options.economy_factor : 1.0;
    self.economyFactor = Math.min(Math.max(0.0, self.economyFactor), 5.0);

    if (!!options.mod)
        bouncer.addPlayerToModlist(client.id);
    else
        bouncer.removePlayerFromModlist(client.id);

    self.nextPrimaryColorIndex = function () {
        if (self.spectator)
            return;

        self.returnColorIndex();
        self.colorIndex = [colors.takeNextAvailableColorIndex(self.colorIndex[0]), 0];
    };

    self.nextSecondaryColorIndex = function () {
        if (self.spectator)
            return;

        var colors = colors.getSecondaryColorsFor(self.colorIndex[0]);
        var max = colors.getNumberOfColors();
        self.colorIndex[1] = (self.colorIndex[1] + 1) % max;
    }

    self.clearColorIndex = function () {
        self.returnColorIndex();
        self.colorIndex = [-1, -1];
    };

    self.maybeTakeColorIndex = function () {
        if (self.spectator || self.colorIndex[0] !== -1)
            return;
        self.colorIndex = colors.takeRandomAvailableColor();
    };

    self.setPrimaryColorIndex = function (index) {
        if (self.spectator)
            return;
        self.colorIndex = [colors.maybeGetNewColorIndex(self.colorIndex[0], index), self.colorIndex[1]];
    };

    self.setSecondaryColorIndex = function (index) {
        if (self.spectator)
            return;

        self.colorIndex = [self.colorIndex[0], index];
    };

    self.returnColorIndex = function () {
        if (self.colorIndex[0] === -1)
            return;

        colors.returnColorIndex(self.colorIndex[0]);
        self.colorIndex = [-1, -1];
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

    self.setAIPersonality = function (personality) {
        if (!self.ai)
            return;

        self.personality = personality;
    };

    self.setAILandingPolicy = function (policy) {
        if (!self.ai)
            return;

        self.landingPolicy = policy;
    };

    self.setEconomyFactor = function (value) {
        value = Math.min(Math.max(0.0, value), 5.0);
        self.economyFactor = value;
    };

    self.asJson = function () {
        return {
            name: self.client.name,
            id: self.client.id,
            ai: self.ai,
            personality: self.personality,
            landing_policy: self.landingPolicy,
            economy_factor: self.economyFactor,
            connected: self.ai ? true : self.client.connected,
            creator: self.ai ? false : self.creator,
            mod: self.ai ? false : bouncer.isPlayerMod(self.client.id),
            army_index: self.armyIndex,
            slot_index: self.slotIndex,
            commander: self.commander,
            ready: self.ready,
            loading: self.loading,
            color: colors.getColorFor(self.colorIndex),
            color_index: self.colorIndex[0]
        };
    };

    self.finalize = function (specTag) {
        return {
            name: self.client.name,
            commander: self.commander + (specTag || ''),
            client: self.client,
            army: self.armyIndex,
            slot: self.slotIndex,
            ai: self.ai,
            personality: self.personality,
            landing_policy: self.landingPolicy
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

        // Do not validate AI commanders or unknown custom commanders in server mods

        if (!self.ai && commanders.isKnownCommanderSpec(new_commander) && !self.client.validateItem(commanderObject)) {
            debug_log("Failed to validate ownership of " + (commanderObject));
            return;
        }

        self.commander = new_commander;

        lobbyModel.updatePlayerState();
    }
};

function ArmyModel(options) {
    var self = this;

    self.slots = options.slots ? Math.max(options.slots, 1) : 1;
    self.alliance = !!options.alliance;
    self.allianceGroup = 0; /* 0 indicates no alliance */
    self.spec_tag = options.spec_tag || '';

    self.asJson = function () {
        return {
            slots: self.slots,
            alliance: self.alliance,
            spec_tag: self.spec_tag
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
            alliance_group: self.allianceGroup,
            spec_tag: self.spec_tag
        };
    };
};

function LobbyModel(creator) {
    var self = this;

    self.maxNumberOfAllowedPlayers = 1;
    self.players = {};
    self.armies = [];
    self.system = {};
    self.minimalSystemDescription = {}; /* system sans custom planet source */
    self.config = {};
    self.settings = {
        hidden: true,
        game_options: _.cloneDeep(DEFAULT_GAME_OPTIONS),
        required_content: content_manager.getRequiredContent(),
    }; /* game_mode spectators broadcast_delay private friends public tag */
    self.control = {}; /* has_first_config starting system_ready sim_ready */

    self.creator = creator;

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

    self.isCreator = function (id) {
        return id === self.creator;
    };

    self.playersInArmy = function(army_index) {
        return _.filter(_.values(self.players), function (element){
            return element.armyIndex === army_index;
        });
    };

    self.aiCount = function () {
        return _.filter(_.values(self.players), function (element) { return element.ai }).length;
    }

    self.totalSlots = function () {

        var result = 0;
        _.forEach(self.armies,function (element) {
            result += element.slots;
        });

        return result;
    };

    self.totalCurrentPlayers = function () {
        var total = 0;
        _.forEach(self.armies, function (element, index) {
            total += self.playersInArmy(index).length;
        });
        return total;
    };

    self.breakArmyIntoAlliances = function (army_index) {
        var army = self.armies[army_index];
        if (!army)
            return;

        var extra = army.slots - 1;
        army.slots = 1;
        var options = army.asJson();

        var group = alliance_groups.splice(0, 1)[0];

        _.invoke(self.players, 'adjustArmyIndexAboveTarget', army_index, extra);

        _.times(extra, function (index) { /* split armies */
            self.armies.splice(army_index, 0, new ArmyModel(options)); /* splice modifies the array */
        });

        _.forEach(self.playersInArmy(army_index), function (element) { /* add players to new armies */
            element.armyIndex += element.slotIndex;
            element.slotIndex = 0;

            self.armies[element.armyIndex].allianceGroup = group;
        });
    }

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
            var army = self.armies[value.armyIndex]
            var specTag = (army && army.spec_tag) || ''
            result[key] = value.finalize(specTag)
        });

        return result;
    };

    self.finalizeArmies = function () {
        var result = _.invoke(self.armies, 'finalizeAsConfig');

        _.forIn(self.players, function (element) {
            var army = result[element.armyIndex];
            if (!army) /* player is spectating */
                return;

            army.slots[element.slotIndex] = element.finalize(army.spec_tag); /* insert finalized block { name, commander, client, army, ai } */

            if (element.slotIndex === 0) { /* only use the color for the first player in the army */
                result[element.armyIndex].color = colors.getColorFor(element.colorIndex); /* insert expanded color */
                result[element.armyIndex].color_index = element.colorIndex[0];
                result[element.armyIndex].econ_rate = element.economyFactor;
            }

            if (element.ai) {
                result[element.armyIndex].personality = element.personality;
                result[element.armyIndex].landing_policy = element.landingPolicy;
            }
        });

        return result;
    }

    self.getFinalData = function () {

        while (true)
        {
            var target = _.findIndex(self.armies, function (element) {
                return element.alliance && element.slots > 1;
            });

            if (target === -1)
                break;

            self.breakArmyIntoAlliances(target);
        }

        _.invoke(self.players, 'maybeTakeColorIndex');

        return {
            game: lobbyModel.finalizeConfig(),
            armies: lobbyModel.finalizeArmies(),
            players: lobbyModel.finalizePlayers(),
            ranked: false
        }
    };

    self.updatePlayerState = function () {
        debug_log('updatePlayerState');
        var players = _.invoke(self.players, 'asJson');
        if (_.isEqual(client_state.players, players))
            return;
        client_state.players = _.cloneDeep(players);
        self.setDirty({players: true});
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
        if (_.isEqual(client_state.system, self.minimalSystemDescription))
            return;
        client_state.system = _.cloneDeep(self.minimalSystemDescription);
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

    self.changeSettings = function (settings /* game_mode spectators hidden friends public tag */) {
        _.assign(self.settings, settings);
        self.updateSettingsState();
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

    self.unreadyAllPlayers = function () {
        debug_log('unreadyAllPlayers');
        _.forIn(self.players, function (element) {
            if (element.ready && !element.ai) {
                server.broadcastEventMessage(element.client.name, ' is no longer ready.');
                element.ready = false;
            }
        });

        self.setDirty({ players: true });
        self.updatePlayerState();
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

    self.addArmy = function (options) {
        if (self.armies.length >= MAX_PLAYERS)
            return;

        if (options.slots && options.slots + self.totalSlots() > MAX_PLAYERS)
            return;

        self.unreadyAllPlayers();

        self.armies.push(new ArmyModel(options));
        self.addPlayersToSlotsIfPossible();
        self.updateArmyState();
    };

    self.removeArmy = function (army_index) {
        var spares = [];

        self.unreadyAllPlayers();

        self.armies.splice(army_index, 1);

        _.forEach(self.players, function (element) {
            if (element.ai && element.armyIndex === army_index)
                spares.push(element.client.id)
        });

        _.forEach(spares, self.removePlayer);

        _.invoke(self.players, 'processRemoveIndex', army_index);

        self.addPlayersToSlotsIfPossible();
        self.updateArmyState();
        self.updatePlayerState();
    };

    self.modifyArmy = function (army_index, options) {
        debug_log('modifyArmy');

        var spares = [];

        var army = self.armies[army_index];
        if (!army)
            return;

        var new_options = _.assign(army.asJson(), options);

        var ai = !!_.filter(self.playersInArmy(army_index), function (element) { return element.ai }).length;
        if (ai)
            new_options.alliance = true; /* override to prevent shared army with ai */

        if (options.slots && (options.slots - army.slots + self.totalSlots()) > MAX_PLAYERS)
            return;

        self.unreadyAllPlayers();

        if (options.slots < army.slots) {
            _.forEach(_.range(options.slots, army.slots), function (index) {
                _.invoke(self.players, 'processRemoveSlotAtIndex', army_index, index);

                _.forEach(self.players, function (element) {
                    if (element.ai && element.armyIndex === army_index && element.slotIndex == index)
                        spares.push(element.client.id)
                });
            });
        }

        _.forEach(spares, self.removePlayer);

        self.armies[army_index] = new ArmyModel(new_options);

        self.addPlayersToSlotsIfPossible();

        self.fixColors();

        self.updateArmyState();
        self.updateColorState();
        self.updatePlayerState();
    };

    self.numPlayerSlots = function() {
        return utils.sum(self.armies, function(army) { return army.ai ? 0 : army.slots; });
    };

    self.numPlayers = function () {
        return _.keys(self.players).length;
    };

    self.updateBeacon = function () {
        debug_log('updateBeacon');
        var numPlayerSlots = self.numPlayerSlots();
        server.maxClients = Math.min(MAX_PLAYERS, numPlayerSlots) + Math.min(MAX_SPECTATORS, main.spectators);
        var publish = !server.closed && (self.settings.public || bouncer.getWhitelist().length) && !self.settings.hidden;

        if (publish) {
            var full = server.clients.length >= server.maxClients;

            var modsData = server.getModsForBeacon();

            var player_names = _.map(_.filter(self.players, { 'spectator': false }), function (player) { return player.client.name; });
            var spectator_names = _.map(_.filter(self.players, { 'spectator': true }), function (player) { return player.client.name; });

            var mode = DEFAULT_GAME_TYPE;
            if (self.settings.game_options)
                mode = self.settings.game_options.game_type;

            server.beacon = {
                uuid: server.uuid(),
                full: full,
                started: self.control.countdown || self.control.starting,
                players: player_names.length,
                creator: self.creatorName(),
                max_players: numPlayerSlots,
                spectators: spectator_names.length,
                max_spectators: main.spectators,
                mode: mode,
                mod_names: modsData.names,
                mod_identifiers: modsData.identifiers,
                cheat_config: main.cheats,
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
                bounty_mode: self.settings.game_options ? !!self.settings.game_options.bounty_mode : false,
                bounty_value: self.settings.game_options ? self.settings.game_options.bounty_value : 0.5,
                sandbox: self.settings.game_options ? !!self.settings.game_options.sandbox : false
            };
        } else {
            server.beacon = null;
        }
    };

    self.addPlayer = function (client, options) {
        debug_log('addPlayer');
        var player = new PlayerModel(client, options);
        self.players[client.id] = player;
        self.updatePlayerState();
        self.updateColorState();

        if (!options.ai) {
            _.delay(server.broadcastEventMessage, 500, player.client.name, ' joined the lobby.');

            debug_log('Player Stats: ');
            debug_log(player.client.statistics);
            client.incrementStatistic("TestStat_LobbiesJoined", 1);
        }
    };

    self.addAI = function (payload) {
        var player_id = getAIId();
        var success = false;

        if (!payload)
            return;

        self.addPlayer({ connected: true, id: player_id, name: getAIName() }, payload.options);

        success = self.addPlayerToArmy(player_id, payload.army_index);
        if (!success)
            self.removePlayer(player_id);
    };

    self.creatorName = function () {
        var player = self.players[self.creator];
        return player ? player.client.name : '';
    };

    self.chooseNextPlayerAsCreator = function () {
        debug_log('chooseNextPlayerAsCreator');
        if (_.isEmpty(self.players))
            return;

        var client = _.first(server.clients);
        if (!client)
            return;

        var id = client.id;
        self.creator = id;

        var player = self.players[id];

        player.creator = true;
        bouncer.addPlayerToModlist(id);

        self.updatePlayerState();
        server.broadcastEventMessage(player.client.name, ' is now the host.');
    };

    self.removePlayer = function (id) {
        debug_log('removePlayer');

        delete client_state.players[id];
        var player = self.players[id];

        if (player) {
            self.removePlayerFromArmy(id, { clear_color: true });

            var ai = player.ai;
            if (!ai)
                server.broadcastEventMessage(player.client.name, ' has left the lobby.');

            player.returnColorIndex();
            delete self.players[id];

            if (!ai) {
                console.log('killing client ' + id);
                player.client.kill();

                // Terminate empty lobbies
                if (!main.keep_alive && !server.connected) {
                    sim.shutdown(false);
                    server.exit();
                    return;
                }

                if (id === self.creator)
                    self.chooseNextPlayerAsCreator();
            }

            if (ai)
                returnAIId(id);

            self.updatePlayerState();
            self.updateColorState();
        }
    };

    self.kickPlayer = function (id) {
        debug_log('kickPlayer');
        bouncer.addPlayerToBlacklist(id);
        self.removePlayer(id);
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

        player.armyIndex = army_index;
        player.slotIndex = count;
        player.spectator = false;

        if (player.ai)
            army.alliance = true; /* override to prevent shared army with ai */

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

        _.forEach(self.playersInArmy(army_index), function (element, index) {
            if (index === 0 || army.alliance)
                element.maybeTakeColorIndex();
            else
                element.returnColorIndex(); /* only the first player in a shared army gets a color */
        });

        self.setDirty({ colors: true });
    };

    self.setPrimaryColorIndex = function (player_id, index, ai) {
        debug_log('{{setPrimaryColorIndex}} '  + index);
        var player = self.players[player_id];

        if (!player || player.ai !== ai || !colors.isValidPrimaryColorIndex(index))
            return;

        player.setPrimaryColorIndex(index);

        self.updatePlayerState();
        self.updateColorState();
    };

    self.setSecondaryColorIndex = function (player_id, index, ai) {
        debug_log('{{setSecondaryColorIndex}} ' + index);
        var player = self.players[player_id];

        if (!player || player.ai !== ai || !colors.isValidColorPair(player.colorIndex[0], index))
            return;

        player.setSecondaryColorIndex(index);

        self.updatePlayerState();
        self.updateColorState();
    };

    self.setAIPersonality = function (player_id, personality) {
        debug_log('setAIPersonality');
        var player = self.players[player_id];

        if (!player || !player.ai)
            return;

        player.setAIPersonality(personality);

        self.unreadyAllPlayers();
        self.updatePlayerState();
    };

    self.setAILandingPolicy = function (player_id, policy) {
        debug_log('setAILandingPolicy');
        var player = self.players[player_id];

        if (!player || !player.ai)
            return;

        player.setAILandingPolicy(policy);

        self.unreadyAllPlayers();
        self.updatePlayerState();
    };

    self.setAICommander = function (player_id, commander) {
        var player = self.players[player_id];

        if (!player || !player.ai)
            return;

        player.setCommander(commander);

        self.unreadyAllPlayers();
        self.updatePlayerState();
    };

    self.setEconomyFactor = function (player_id, value) {
        debug_log('setEconomyFactor');
        var player = self.players[player_id];

        if (!player)
            return;

        if (player.economyFactor != value)
        {
            player.setEconomyFactor(value);

            self.unreadyAllPlayers();
            self.updatePlayerState();
        }
    };

    self.validateSetup = function () {
        debug_log('validateSetup');
        var totalOpenSlots = self.numPlayerSlots();
        var totalPlayersInSlots = utils.sum(self.players, function (player) { return player.armyIndex >= 0; });

        debug_log('Validation:'+ totalPlayersInSlots+ '/'+ totalOpenSlots); /* todo: add validation stage to control state */

        if (totalPlayersInSlots !== totalOpenSlots)
            return 'Empty slots encountered';
    };

    self.gameType = function() {
        if (!self.settings.game_options)
            return null;
        return self.settings.game_options.game_type;
    };
};

var lobbyModel;

var cleanup = [];
var cleanupOnEntry = [];

function allowChangesFrom(client) {
    if (!client || !lobbyModel.isCreator(client.id))
        return false;
    if (lobbyModel.control.countdown)
        return false;
    if (lobbyModel.control.starting)
        return false;

    return true;
}

function playerMsg_resetArmies(msg){
    debug_log('playerMsg_resetArmies');
    var response = server.respond(msg);
    var payload = msg.payload;

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    _.forEach(lobbyModel.players, function (element, key) {
        if (element.ai)
            lobbyModel.removePlayer(key);
        else
            lobbyModel.removePlayerFromArmy(key);
    });

    lobbyModel.armies = [];
    _.forEach(payload, function (element) {
        lobbyModel.addArmy(element);
    });

    lobbyModel.changeControl({ has_first_config: true });

    response.succeed();
};

function playerMsg_addArmy(msg /* client payload */){
    debug_log('playerMsg_addArmy');
    var response = server.respond(msg);
    var payload = msg.payload;

    if (!payload.options)
        return response.fail("Not allowed.");

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.addArmy(payload.options);

    response.succeed();
}

function playerMsg_removeArmy(msg){
    debug_log('playerMsg_removeArmy');
    var response = server.respond(msg);
    var payload = msg.payload;

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.removeArmy(payload.army_index);

    response.succeed();
}

function playerMsg_addAI(msg) {
    debug_log('playerMsg_addAI');

    var response = server.respond(msg);
    var payload = msg.payload;

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.addAI(payload);

    response.succeed();
}

function playerMsg_modifySystem(msg) {
    debug_log('modifySystem');
    var response = server.respond(msg);
    var payload = msg.payload;

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    var systemValidationResult = sim_utils.validateSystemConfig(msg.payload);
    if (_.isString(systemValidationResult)) {
        debug_log('Invalid system');
        return response.fail("Invalid system provided - " + systemValidationResult);
    }
    else
        systemValidationResult.then( function () {
            lobbyModel.changeSystem(msg.payload);
            response.succeed();
        });
}

function playerMsg_modifyArmy(msg){
    debug_log('modifyArmy');
    var response = server.respond(msg);
    var payload = msg.payload;

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.modifyArmy(payload.army_index, payload.options);

    response.succeed();
}

function updateBouncer(config) {

    if (config.password || bouncer.doesGameRequirePassword())
        bouncer.setPassword(config.password);

    bouncer.clearWhitelist();
    var hasFriendsList = config.friends && config.friends.length;
    if (hasFriendsList) {
        _.forEach(config.friends, function (element) { bouncer.addPlayerToWhitelist(element); });
    }

    bouncer.clearBlacklist();
    var hasBlockList = config.blocked && config.blocked.length;
    if (hasBlockList) {
        _.forEach(config.blocked, function (element) { bouncer.addPlayerToBlacklist(element); });
    }
}


function playerMsg_modifyBouncer(msg) {
    debug_log('playerMsg_modifyBouncer');

    var config = msg.payload;
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    updateBouncer(config);

    lobbyModel.setDirty({ beacon: true });

    response.succeed();
}

function playerMsg_modifySettings(msg) {

    debug_log('playerMsg_modifySettings');
    var config = msg.payload;
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client)) {
        lobbyModel.setDirty({ settings: true });
        return response.fail("Not allowed.");
    }

    var game_options = _.cloneDeep(DEFAULT_GAME_OPTIONS);

    var settings = {
        max_spectators: MAX_SPECTATORS,
        max_players: MAX_PLAYERS,
        spectators: MAX_SPECTATORS,
        hidden: false,
        friends: false,
        public: true,
        tag: DEFAULT_LOBBY_TAG,
        game_name: DEFAULT_LOBBY_NAME,
        required_content: content_manager.getRequiredContent(),
    };

    if (config.game_options)
        game_options.game_type = config.game_options.game_type;
    else if (client_state.settings && client_state.settings.game_options)
        game_options.game_type = client_state.settings.game_options.game_type;

    if (!isValidGameType(game_options.game_type))
        game_options.game_type = DEFAULT_GAME_TYPE;

    updateBouncer(config);
    var hasFriendsList = bouncer.getWhitelist().length;

    if (config.game_options)
    {
        game_options.land_anywhere = !!config.game_options.land_anywhere;

        if (isFFAType(game_options.game_type)) {
            game_options.dynamic_alliances = !!config.game_options.dynamic_alliances;
            if (game_options.dynamic_alliances)
                game_options.dynamic_alliance_victory = !!config.game_options.dynamic_alliance_victory;
        }
        if (config.game_options.bounty_mode)
            game_options.bounty_mode = _.contains(content_manager.getRequiredContent(), 'PAExpansion1') && !!config.game_options.bounty_mode;
        if (config.game_options.bounty_value)
            game_options.bounty_value = config.game_options.bounty_value;
        if (config.game_options.sandbox)
            game_options.sandbox = !!config.game_options.sandbox;
        if (config.game_options.listen_to_spectators)
            game_options.listen_to_spectators = !!config.game_options.listen_to_spectators;
    }

    settings.hidden = (!hasFriendsList && !config.public);
    settings.friends = !!hasFriendsList;
    settings.public = (config.public && !hasFriendsList);
    if (config.tag)
        settings.tag = config.tag;

    settings.spectators = Math.min(Number(config.spectators), MAX_SPECTATORS);

    if (_.isString(config.game_name))
        settings.game_name = config.game_name.substring(0, Math.min(config.game_name.length, 128));

    _.forEach(_.keys(lobbyModel.settings.game_options), function (key) {
        if (lobbyModel.settings.game_options[key] !== game_options[key]) {
            var name = key.replace(/_/g, ' ');
            var message = name + ' ' +
                (_.isBoolean(game_options[key])
                    ? (!!game_options[key] ? 'enabled' : 'disabled')
                    : ('changed'))
                + '.';
            server.broadcastEventMessage('', message, 'settings');
        }
    });

    settings.game_options = game_options;

	var nameChangeOnly = false;

	if (settings.game_name !== lobbyModel.settings.game_name) {
		var currentSettings = _.cloneDeep(lobbyModel.settings);
		delete currentSettings.game_name;
		var newSettings = _.cloneDeep(settings);
		delete newSettings.game_name;

		nameChangeOnly = _.isEqual(currentSettings, newSettings);
	}

    lobbyModel.changeSettings(settings);

	if (!nameChangeOnly) {
    	lobbyModel.unreadyAllPlayers();
	}

    response.succeed();
}

function maybeStartLandingState() {
    debug_log('maybeStartLandingState');
    if (!lobbyModel.control.starting || !lobbyModel.control.system_ready || !lobbyModel.control.sim_ready)
        return;

    lobbyModel.updateClientState();

    var final_data = lobbyModel.getFinalData();

    try {
        if (server_utils.log_lobby_description) {
            console.log('final lobby data:');
            console.log(JSON.stringify(final_data, null, '\t'));
        }
    }
    catch (e) {
        console.log('final lobby data: failed.'); // this is *not* expected.
    };

    hasStartedPlaying = true;
    main.setState(main.states.landing, final_data);
}



function playerMsg_startCountdown(msg) {
    debug_log('playerMsg_startGame');
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    var player = lobbyModel.players[msg.client.id];
    player.ready = true;

    function not_ready (){
        return _.some(lobbyModel.players, function (value) {
            return !value.ready && !value.spectator;
    });
    }

    if (not_ready()) {
        player.ready = false;
        return response.fail("Not ready.");

    }

    var lobbyValidationResult = lobbyModel.validateSetup();
    if (lobbyValidationResult) {
        player.ready = false;
        return response.fail("Invalid game setup - " + lobbyValidationResult);
    }

    if (!lobbyModel.control.sim_ready) {
        player.ready = false;
        return response.fail("Server is not done gerating planets");
    }

    lobbyModel.updatePlayerState();
    lobbyModel.changeControl({ countdown: true });

    function startGame() {

        server.broadcastEventMessage('', -1, 'countdown');

        server.broadcastEventMessage('', 'Game is starting.');

        lobbyModel.changeControl({ starting: true });
        maybeStartLandingState();
    }

    var count = _.has(msg, 'countdown') ? msg.countdown : START_GAME_DELAY;
    function countdownToStartGame() {
        server.broadcastEventMessage('', count, 'countdown');
        count -= 1;

        if (count > 0)
            setTimeout(countdownToStartGame, 1000);
        else
            setTimeout(startGame, 1000);
    }

    if (lobbyModel.totalCurrentPlayers() < 2)
        startGame();
    else {
        server.broadcastEventMessage('', 'Game will start in ' + START_GAME_DELAY + ' seconds.');
        countdownToStartGame();
    }

    response.succeed();
}

function playerMsg_setPrimaryColorIndex(msg) {
    debug_log('playerMsg_setPrimaryColorIndex');
    debug_log(msg);
    var response = server.respond(msg);

    lobbyModel.setPrimaryColorIndex(msg.client.id, msg.payload, false);
    response.succeed();
}

function playerMsg_setPrimaryColorIndexForAI(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setPrimaryColorIndex(msg.payload.id, msg.payload.color, true);
    response.succeed();
}

function playerMsg_setSecondaryColorIndex(msg) {
    debug_log('playerMsg_setSecondaryColorIndex');
    debug_log(msg);
    var response = server.respond(msg);

    lobbyModel.setSecondaryColorIndex(msg.client.id, msg.payload, false);
    response.succeed();
}

function playerMsg_setSecondaryColorIndexForAI(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setSecondaryColorIndex(msg.payload.id, msg.payload.color, true);
    response.succeed();
}

function playerMsg_setAIPersonality(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setAIPersonality(msg.payload.id, msg.payload.ai_personality);
    response.succeed();
}

function playerMsg_setAILandingPolicy(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setAILandingPolicy(msg.payload.id, msg.payload.ai_landing_policy);
    response.succeed();
}

function playerMsg_setAICommander(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setAICommander(msg.payload.id, msg.payload.ai_commander);

    response.succeed();
}

function playerMsg_setEconomyFactor(msg) {
    var response = server.respond(msg);

    if (!allowChangesFrom(msg.client))
        return response.fail("Not allowed.");

    lobbyModel.setEconomyFactor(msg.payload.id, msg.payload.economy_factor);
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

function playerMsg_joinArmy(msg) {
    debug_log('playerMsg_joinArmy');
    var response = server.respond(msg);
    var player = lobbyModel.players[msg.client.id];

    if (!msg.payload || !player)
        return response.fail("Invalid message");

    if (msg.payload.commander)
        player.setCommander(msg.payload.commander);

    lobbyModel.removePlayerFromArmy(msg.client.id);
    if (lobbyModel.addPlayerToArmy(msg.client.id, msg.payload.army)) {
        server.broadcastEventMessage(player.client.name, ' has joined an army.');
        response.succeed();
    } else {
        response.fail("Unable to add player to army");
    }
}

function playerMsg_toggleReady(msg) {
    debug_log('playerMsg_toggleReady');

    var response = server.respond(msg);
    var player = lobbyModel.players[msg.client.id];

    if (!player)
        return response.fail("Invalid message");

    if (client_state.control.countdown)
        return response.fail("Cannot change ready after countdown has started.");

    player.ready = !player.ready;

    lobbyModel.updatePlayerState();

    server.broadcastEventMessage(player.client.name, player.ready ? ' is now ready.' : ' is no longer ready.');

    response.succeed();
}

function playerMsg_leaveArmy(msg) {
    debug_log('playerMsg_leaveArmy');
    var response = server.respond(msg);

    var player = lobbyModel.players[msg.client.id];
    if (!player)
        return;

    if (lobbyModel.removePlayerFromArmy(msg.client.id, { clear_color: true, set_spectator: true })) {
        server.broadcastEventMessage(player.client.name, ' is now a spectator.');
        response.succeed();
    } else {
        response.fail('Could not remove you from the army');
    }
}

function playerMsg_chatMessage(msg) {
    debug_log('playerMsg_chatMessage');
    var response = server.respond(msg);
    if (!msg.payload || !msg.payload.message)
        return response.fail("Invalid message");

    var payload = {
        player_name: msg.client.name,
        message: msg.payload.message
    };

    lobbyChatHistory.push(payload);
    lobbyChatHistory.slice(-MAX_LOBBY_CHAT_HISTORY,0);

    server.broadcast({
        message_type: 'chat_message',
        payload: payload
    });
    response.succeed();
}

function playerMsg_chatHistory(msg) {
    debug_log('playerMsg_chatHistory');
    var response = server.respond(msg);
    response.succeed({ chat_history: lobbyChatHistory });
}

function playerMsg_jsonMessage(msg) {
    debug_log('playerMsg_jsonMessage');
    var response = server.respond(msg);
    if (!msg.payload)
        return response.fail("No payload");
    server.broadcast({
        message_type: 'json_message',
        payload: {
            id: msg.client.id,
            uberId: msg.client.uberId,
            payload: msg.payload,
        }
    });
    response.succeed();
}

function playerMsg_leave(msg) {
    debug_log('playerMsg_leave');
    var response = server.respond(msg);

    lobbyModel.removePlayer(msg.client.id);

    response.succeed();
}

function playerMsg_kick(msg) {
    debug_log('playerMsg_kick');
    debug_log(msg);
    var response = server.respond(msg);

    var id = msg.payload.id;
    var player = lobbyModel.players[id];

    if (!bouncer.isPlayerMod(msg.client.id))
        return response.fail("Only mods can kick.");

    if (bouncer.isPlayerMod(id))
        return response.fail("Mods cannot be kicked.");

    if (!player)
        return response.fail("Already left");

    bouncer.addPlayerToBlacklist(id);

    lobbyModel.kickPlayer(id);

    response.succeed();
}

function playerMsg_promoteToMod(msg) {
    debug_log('playerMsg_promoteToMod');
    var response = server.respond(msg);
    var id = msg.payload.id;
    var player = lobbyModel.players[id];

    if (!bouncer.isPlayerMod(msg.client.id))
        return response.fail("Only mods can promote.");

    if (!player)
        return response.fail("Player is absent");
    response.succeed();

    bouncer.addPlayerToModlist(id);
    lobbyModel.updatePlayerState();
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

function playerMsg_modDataAvailable(msg) {
    debug_log('playerMsg_modDataAvailable');

    var response = server.respond(msg);

    if (lobbyModel.creator !== msg.client.id) {
        return response.fail("Mod data can only be provided by lobby creator");
    }

    var auth_token = "";
    var hasMods = false;
    var mods = server.getMods();
    if (mods !== undefined) {
        auth_token = mods.auth_token || "";
        if (mods.mounted_mods !== undefined && mods.mounted_mods.length > 0) {
            hasMods = true;
        }
    }
    if (hasMods) {
        return response.fail("Mod data is already mounted");
    }

    response.succeed({ "auth_token": auth_token });
}

function check_cheat(cheatname, callback) {
    file.load('/server-script/modroot/cheat_' + cheatname + '.json', function (data) {
        var cheat_enabled = false;
        if (data !== undefined && data.length > 0) {
            var config = JSON.parse(data);
            if (config.cheat_flags !== undefined) {
                if (config.cheat_flags[cheatname]) {
                    main.cheats.cheat_flags[cheatname] = true;
                    main.cheats.cheat_flags.any_enabled = true;
                    main.cheats.cheat_flags.cheat_mod_enabled = true;
                    cheat_enabled = true;
                    console.log('CHEATS: Mod enabled cheat: ' + cheatname);

                    server.broadcast({
                        message_type: 'set_cheat_config',
                        payload: main.cheats
                    });
                }
            }
        }
        if (callback !== undefined) {
            callback(cheat_enabled);
        }
    });
}

function playerMsg_modDataUpdated(msg) {
    check_cheat('allow_change_vision');
    check_cheat('allow_change_control');
    check_cheat('allow_create_unit');
    check_cheat('allow_mod_data_updates', function (cheat_enabled) {
        if (cheat_enabled) {
            server.disableWriteReplay();
        } else {
            server.resetModUpdateAuthToken();
        }
    });

    commanders.update();

    _.forEach(server.clients, function (client) {
        var mods = server.getModsPayload();

        if (client.id !== msg.client.id) {
            client.message({
                message_type: 'downloading_mod_data',
                payload: mods
            });
            client.downloadModsFromServer();
        } else {
            client.message({
                message_type: 'mount_mod_file_data',
                payload: mods
            });
        }
    });
}

function playerMsg_requestCheatConfig(msg) {
    debug_log('playerMsg_requestCheatConfig');

    var response = server.respond(msg);

    response.succeed({ "cheat_config": main.cheats });
}

function initOwner(owner) {
    debug_log('initOwner');
    server.maxClients = 1;

    var client_data = { uberid: '', password: '', uuid: '' };

    if (!owner) {
        var testConfig = _.cloneDeep(require('test').exampleConfig);
        main.setState(main.states.lobby, testConfig);
        return client_data;
    }

    bouncer.addPlayerToModlist(owner.id);

    try {
        client_data = JSON.parse(owner.data);
        bouncer.setUUID(client_data.uuid);

        // add uberId for custom servers
        owner.uberid = client_data.uberid;
    }
    catch (error) {
        debug_log('js initOwner : unable to parse owner data');
    }
    return client_data;
}

exports.url = 'coui://ui/main/game/new_game/new_game.html';
exports.enter = function (owner) {

    var client_data = initOwner(owner);

    if (SERVER_PASSWORD && client_data.password !== SERVER_PASSWORD ) {
        sim.shutdown(false);
        server.exit();
        return;
    }

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

            // add uberId for custom servers
            client.uberid = client_data.uberid;
        }
        catch (e) {
            debug_log('js utils.pushCallback : unable to parse client.data');
            server.rejectClient(client, 'Bad Client data');
            return onConnect;
        }

        if (!bouncer.isPlayerValid(client_data.uberid, client_data.password, client_data.uuid, lobbyModel.settings.public)) {
            console.log('invalid credentials');
            server.rejectClient(client, 'Credentials are invalid');
            return onConnect;
        }

        if (!reconnect) {
            var max = Math.min(MAX_CLIENTS, lobbyModel.numPlayerSlots() + main.spectators);
            if (lobbyModel.numPlayers() >= max) {
                console.error('lobby at capacity. client rejected.');
                server.rejectClient(client, 'No room');
                return onConnect;
            }
        }

        utils.pushCallback(client, 'onDisconnect', function (onDisconnect) {
            if (!hasStartedPlaying) { /* don't kill the client unless we have not started any other states. */
                console.log('removing disconnected player from the lobby.');
                lobbyModel.removePlayer(client.id);
            }
            return onDisconnect;
        });
        cleanup.push(function () {
            if (client.onDisconnect) {
                console.log('remove disconnect handler');
                client.onDisconnect.pop();
            }
            /* removePlayer calls client.kill(), which will destroy the onDisconnect handler */
        });

        var players = _.filter(lobbyModel.players, { 'spectator': false });
        var options = { mod: bouncer.isPlayerMod(client.id), creator: client.id === lobbyModel.creator };
        /* force the player to be a spectator */
        if (players.length >= MAX_PLAYERS)
            options.spectator = true;

        if (!lobbyModel.players.hasOwnProperty(client.id))
            lobbyModel.addPlayer(client, options);
        else
            lobbyModel.updatePlayerState();

        lobbyModel.addPlayersToSlotsIfPossible();

        var player = lobbyModel.players[client.id];
        if (player.armyIndex === -1) /* make the player a spectator if there is no room */
            player.spectator = true;

        client.message({
            message_type: 'downloading_mod_data',
            payload: server.getModsPayload()
        });

        debug_log('calling client.downloadModsFromServer');
        client.downloadModsFromServer();

        client.message({
            message_type: 'set_cheat_config',
            payload: main.cheats
        });

        return onConnect;
    });
    cleanupOnEntry.push(function () { server.onConnect.pop(); });

    lobbyModel.creator = owner.id;
    lobbyModel.addPlayer(owner, { mod: true, creator: true });
    bouncer.addPlayerToModlist(owner.id);

    _.forEach(server.clients, function (client) {
        if (client !== owner) {
            lobbyModel.addPlayer(client, { mod: false, creator: false });
        }
    });

    var removeHandlers = server.setHandlers({
        reset_armies: playerMsg_resetArmies,
        add_army: playerMsg_addArmy,
        remove_army: playerMsg_removeArmy,
        add_ai: playerMsg_addAI,
        modify_system: playerMsg_modifySystem,
        modify_army: playerMsg_modifyArmy,
        modify_bouncer: playerMsg_modifyBouncer,
        modify_settings: playerMsg_modifySettings,
        start_game: playerMsg_startCountdown,
        set_primary_color_index: playerMsg_setPrimaryColorIndex,
        set_primary_color_index_for_ai: playerMsg_setPrimaryColorIndexForAI,
        set_secondary_color_index: playerMsg_setSecondaryColorIndex,
        set_secondary_color_index_for_ai: playerMsg_setSecondaryColorIndexForAI,
        set_ai_personality: playerMsg_setAIPersonality,
        set_ai_landing_policy: playerMsg_setAILandingPolicy,
        set_ai_commander: playerMsg_setAICommander,
        set_econ_factor: playerMsg_setEconomyFactor,
        join_army: playerMsg_joinArmy,
        toggle_ready: playerMsg_toggleReady,
        leave_army: playerMsg_leaveArmy,
        update_commander: playerMsg_updateCommander,
        chat_message: playerMsg_chatMessage,
        leave: playerMsg_leave,
        kick: playerMsg_kick,
        promote_to_mod: playerMsg_promoteToMod,
        set_loading: playerMsg_setLoading,
        mod_data_available: playerMsg_modDataAvailable,
        mod_data_updated: playerMsg_modDataUpdated,
        request_cheat_config: playerMsg_requestCheatConfig,
        json_message: playerMsg_jsonMessage,
        chat_history: playerMsg_chatHistory
    });
    cleanup.push(function () { removeHandlers(); });

    lobbyModel.updateBeacon();

    return client_state;
};

exports.exit = function (newState) {
    _.forEachRight(cleanup, function (c) { c(); });
    cleanup = [];

    return true;
};

main.gameModes.lobby = exports;
// This is for backwards compatibility.  Game used to ask for 'Config' game mode.
main.gameModes.Config = exports;
