var _ = require('thirdparty/lodash');
var utils = require('utils');
var server_utils = require('server_utils');

var requiredContent = [];
var contentPending = false;

function validateContent(client) {
    var client_content = [];
    try {
        var client_data = JSON.parse(client.data);
        client_content = _.sortBy(client_data.with_content || []);
    }
    catch (e) { }

    if (!_.isEqual(_.sortBy(requiredContent), client_content))
    {
        console.log("Rejecting connection from client that only has the following content mounted: " + JSON.stringify(client_content) + ", but need: " +  JSON.stringify(_.sortBy(requiredContent)));
        client.message({
            message_type: 'mismatched_content',
            payload: requiredContent
        });
        server.rejectClient(client, "Connecting with wrong expansion pack set up.");
        return;
    }

    var missingContent = _.filter(requiredContent, function(content) { return !client.validateItem(content); });

    if (!_.isEmpty(missingContent))
    {
        console.log("Rejecting connection from client that does not own all the content they claim they have mounted: " + JSON.stringify(missingContent));
        server.rejectClient(client, "Do not own the expansion pack.");
    }
};

exports.setContentPending = function(pending)
{
    if (contentPending === pending)
        return;

    contentPending = pending;
    if (!pending)
    {
        _.forEach(server.clients, function (client) {
            validateContent(client);
        });
    }
}

exports.setRequiredContent = function(content) {
    if (!_.isArray(content))
    {
        console.error("Non-array object passed to content_manager.setRequiredContent: " + JSON.stringify(content));
        content = [];
    }

    if (_.isEqual(requiredContent, content))
        return;

    server.mountContent(content);
    requiredContent = content;
    exports.setContentPending(false);

};

exports.getRequiredContent = function() {
    return requiredContent;
};

exports.getMatchmakingType = function() {
    var type = 'Ladder1v1';
    if (!_.isEmpty(requiredContent))
        type = _.sortBy(requiredContent).join(',') + ':' + type;
    return type;
};

utils.pushCallback(server, 'onConnect', function(onConnect, client, reconnect) {
    if (!contentPending)
        validateContent(client);

    return onConnect;
});
