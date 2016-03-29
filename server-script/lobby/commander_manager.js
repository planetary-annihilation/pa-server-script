var _ = require('thirdparty/lodash');
var Q = require('thirdparty/q');
var file_utils = require('file_utils');

function commanderSpec(name) { return '/pa/units/commanders/' + name + '/' + name + '.json'; }
var default_commanders = _.map(['raptor_centurion', 'raptor_rallus', 'tank_aeson', 'quad_osiris', 'raptor_nemicus', 'imperial_invictus'], commanderSpec)

var commanders = [];
var specObjectNameMap = {};
var objectSpecPathMap = {};
var knownCommanderSpecObjectNameMap = {};

function updateCommanders() {
    commanders = file_utils.loadJsonBlocking('/pa/units/commanders/commander_list.json');

    if (_.has(commanders, 'commanders'))
        commanders = commanders.commanders;
    else
        commanders = [];

    specObjectNameMap = {};

    _.forEach(commanders, function(commander) {
        var commanderData = file_utils.loadJsonBlocking(commander);
        if (_.has(commanderData, 'catalog_object_name'))
            specObjectNameMap[commander] = commanderData.catalog_object_name;
    });
    
    // first update is known commanders

    if ( _.size(knownCommanderSpecObjectNameMap) == 0) {
        knownCommanderSpecObjectNameMap = specObjectNameMap;
    }

    objectSpecPathMap = _.invert(specObjectNameMap);
}

updateCommanders();

function CommanderManager() {
    self = this;

    self.update = function() {
        updateCommanders();
    }

    self.isKnownCommanderSpec = function(spec) {
        return !!knownCommanderSpecObjectNameMap[ spec ];    
    };

    self.getCommanderObjectName = function (spec) {
        if (_.has(specObjectNameMap, spec))
            return specObjectNameMap[spec];
        return null;
    };

    self.getObjectSpecPath = function (name) {
        if (_.has(objectSpecPathMap, name))
            return objectSpecPathMap[name];
        return null;
    };

    self.getRandomDefaultCommanderSpec = function() {
        return _.sample(default_commanders);
    };
};

exports.CommanderManager = CommanderManager;
