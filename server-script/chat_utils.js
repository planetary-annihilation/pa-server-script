var _ = require('thirdparty/lodash');
var server = require('server');

exports.getChatHandlers = function(players, options) {
    if (!options)
        options = {};

    function isAlly(army, targetArmy) {
        if (!army || !targetArmy)
            return false;
        var state = army.sim.getDiplomaticState(targetArmy.sim.id);
        if (state === 'allied' || state === 'allied_eco')
            return true;
        return false;
    }

    function hasUndefeatedAlly(team) {
        return team && _.any(players, function (element) {
            var target_team = element ? element.army : null;
            return target_team && !target_team.defeated && isAlly(team, target_team);
        });
    }

    function considerArmySpectatorBecauseOfDefeat(army)
    {
        if (options.ignore_defeated_state)
            return false;
        return (army.defeated && !hasUndefeatedAlly(army))
    }

    function teamChatMessage(msg) {
        var response = server.respond(msg);
        if (!msg.payload || !msg.payload.message)
            return response.fail("Invalid message");
        var broadcast = {
            message_type: 'chat_message',
            payload: {
                player_name: msg.client.name,
                message: msg.payload.message,
                type: "team"
            }
        };
        var player = players[msg.client.id];
        var team = player ? player.army : null;
        var spectator = !team || considerArmySpectatorBecauseOfDefeat(team);

        _.forEach(server.clients, function(client) {
            var peer = players[client.id];
            var peerArmy = peer ? peer.army : null;
            var peerSpectator = !peerArmy || considerArmySpectatorBecauseOfDefeat(peerArmy);

            if ((spectator && peerSpectator)
                    || peerArmy === team
                    || isAlly(team, peerArmy))
                client.message(broadcast);
        });
        response.succeed();
    }

    function chatMessage(msg) {
        var player = players[msg.client.id];
        var team = player ? player.army : null;
        var spectator = !team || considerArmySpectatorBecauseOfDefeat(team);

        if (spectator && !options.listen_to_spectators)
            return teamChatMessage(msg);

        var response = server.respond(msg);
        if (!msg.payload || !msg.payload.message)
            return response.fail("Invalid message");
        server.broadcast({
            message_type: 'chat_message',
            payload: {
                player_name: msg.client.name,
                message: msg.payload.message,
                type: "global"
            }
        });
        response.succeed();
    }

    var handlers = {
        team_chat_message: teamChatMessage,
        chat_message: chatMessage
    };

    return handlers;
};