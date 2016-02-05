var _ = require('thirdparty/lodash');

var FIRST_CONNECT_WAIT = 0.5 * 60 * 1000; // In ms.
var TOTAL_STARTUP_WAIT = 6.0 * 60 * 1000; // In ms.
var WAIT_FOR_LOAD      = 2.0 * 60 * 1000; // In ms.

var debugging = false;

function debug_log(object) {
    if (debugging)
        console.info("LadderLobbyWatchdog: " + JSON.stringify(object,null,'\t'));
}


function LobbyPlayer() {
    var self = this;

    self.seenOnce = false;
    self.lastSeen = null;
    self.timeoutRemaining = FIRST_CONNECT_WAIT;

    self.isPresent = function() {
        return !self.lastSeen;
    };

    self.getTimeoutRemaining = function(current_time) {
        return Math.max(self.timeoutRemaining - self.getGoneDuration(current_time), 0);
    };

    self.getGoneDuration = function(current_time) {
        if (self.isPresent())
            return 0;
        else
            return current_time - self.lastSeen;
    };

    self.markAsPresent = function(current_time) {
        if (self.isPresent())
            return;

        self.timeoutRemaining -= self.getGoneDuration(current_time);
        if (!self.seenOnce)
        {
            self.timeoutRemaining = 0.1;
            self.seenOnce = true;
        }

        self.lastSeen = null;
    };

    self.markAsGone = function(current_time) {
        if (!self.isPresent())
            return;
        self.lastSeen = current_time;
    };

    self.hasAbandoned = function(current_time) {
        return (self.timeoutRemaining <= self.getGoneDuration(current_time));
    };
}

// Class responsible for making sure a ladder lobby cannot be griefed
// by making it never start. If you don't show up for the lobby, the game
// is aborted (in the future we'll make sure to penalize the MIA players)
// and if never "finish loading" (which is client-moddable) we force you to
// start the game anyway. The playing state will make sure that the game
// will eventually end (timeout or defeat) after this.
function LadderLobbyWatchdog(options) {
    var self = this;

    _.defaults(options, {
        lobby_model: null,
        start_game_callback: _.noop,
        abandon_game_callback: _.noop,
        abort_game_callback: _.noop,
        shutdown_delay: 5.0 * 1000.0
    });

    self.expectedPlayers = null;
    self.state = null;
    self.startGameDelay = 5;
    self.watchdogStart = null;

    self.lobbyModel = options.lobby_model;
    self.startCallback = options.start_game_callback;
    self.abandonCallback = options.abandon_game_callback;
    self.abortCallback = options.abort_game_callback;
    self.shutdownDelay = options.shutdown_delay;

    self.setupWatchdog = function(start_game_delay) {
        if (self.state)
            return null;

        self.expectedPlayers = _.zipObject(_.map(_.flatten(self.lobbyModel.ladderArmies), function(u) { return [u, new LobbyPlayer()]; }));

        if (_.isEmpty(self.expectedPlayers)) {
            self.expectedPlayers = null;
            console.error("No uberids expected, but setting up watchdog!");
            return null;
        }

        self.startGameDelay = start_game_delay;

        self.watchdogStart = new Date().getTime();
        self.setState('empty');

        return function() { self.setTimer(null); }
    };

    self.getPresentUberIds = function() {
        return _.map(_.values(self.lobbyModel.players), function (p) { return p.client_data && p.client_data.uberid; });
    }

    self.updatePlayerState = function() {
        if (self.state === 'abandoned' || self.state === 'aborting')
            return;

        var current_time = new Date().getTime();
        self.updateAbandonmentState(current_time);
        var present_uberids = self.getPresentUberIds();
        if (self.state === 'empty' && present_uberids.length > 0) {
            self.setState('waiting');
        }

        if (self.state === 'waiting') {
            var missing_uberids = _.difference(_.keys(self.expectedPlayers), self.getPresentUberIds());
            if (missing_uberids.length === 0) {
                self.setState('loading');
            } else {
                var disconnected_players = _.filter(self.expectedPlayers, function(p) { return !p.isPresent(); });
                if (disconnected_players.length > 0) {
                    var playerNearestTimeout = _.min(disconnected_players, function(p) { return p.getTimeoutRemaining(current_time); });
                    var recheckTime = playerNearestTimeout.getTimeoutRemaining(current_time) + 500;
                    debug_log("Setting player state recheck to " + recheckTime + "ms");
                    self.setTimer(self.updatePlayerState, recheckTime);
                } else {
                    // This is a weird state -- we're missing a player, but they're supposedly all here.
                    console.error("Mismatch between server presence and our own: " + missing_uberids + " vs " + disconnected_players);
                    self.setTimer(self.updatePlayerState, 1000);
                }
            }
        } else if (self.state === 'loading') {
            var any_loading = _.some(self.lobbyModel.players, function (value) {
                return !value.spectator && value.loading;
            });

            if (!any_loading) {
                self.setState('countdown');
            }
        }
    };

    self.setState = function(state) {
        if (state === self.state)
            return;

        debug_log("State: " + self.state + " -> " + state);

        self.state = state;
        self.setTimer(null);
        if (self.state === 'empty') {
            var time_since_start = new Date().getTime() - self.watchdogStart;
            if (time_since_start > TOTAL_STARTUP_WAIT) {
                self.setState('aborting');
            } else {
                self.setTimer(function() { self.setState('aborting'); }, TOTAL_STARTUP_WAIT - time_since_start);
            }
        } else if (self.state === 'waiting') {
            // Nothing.
        } else if (self.state === 'loading') {
            self.setTimer(function() { self.setState('countdown'); }, WAIT_FOR_LOAD);
        } else if (self.state === 'countdown') {
            self.startCountdown();
        } else if (self.state === 'abandoned') {
            self.setTimer(function() { self.setState('aborting'); }, self.shutdownDelay);
        } else if (self.state === 'aborting') {
            self.abortCallback();
        }

        self.updatePlayerState();
    };

    self.updateAbandonmentState = function(current_time) {
        var present_players = self.getPresentUberIds();
        _.forEach(self.expectedPlayers, function(player, id) {
            if (_.contains(present_players, id) || !present_players.length) {
                player.markAsPresent(current_time);
            } else {
                player.markAsGone(current_time);
                if (self.state === 'loading') {
                    self.setState('waiting');
                }
            }

            if (player.hasAbandoned(current_time)) {
                self.markAsAbandoned(player.seenOnce, id);
                return false;
            }
        });
    };

    self.markAsAbandoned = _.once(function(apply_penalty, uberid) {
        var present_uberids = self.getPresentUberIds();
        var remaining = _.filter(present_uberids, function(u) { return u && u !== uberid; });
        // If every player has been disconnected, this might be a network outage.
        // In that case we don't penalize the player.
        if (!_.isEmpty(remaining))
            self.abandonCallback(apply_penalty, [uberid], remaining);
        self.setState('abandoned');
    });

    self.startCountdown = function() {
        function startGame() {
            server.broadcastCountdownEvent(-1);
            self.startCallback();
        };

        var seconds = self.startGameDelay;
        function countdown() {
            server.broadcastCountdownEvent(seconds);
            seconds -= 1;

            if (seconds > 0)
                self.setTimer(countdown, 1000);
            else
                self.setTimer(startGame, 1000);
        };

        countdown();
    };

    self.setTimer = (function() {
        var timer = null;
        return function(new_timer, timeout) {
            if (timer) {
                clearTimeout(timer);
                timer = null;
            }

            if (new_timer)
                timer = setTimeout(function() { timer = null; new_timer(); }, timeout);
        };
    })();
}

exports.LadderLobbyWatchdog = LadderLobbyWatchdog;
