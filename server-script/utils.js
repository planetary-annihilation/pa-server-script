var _ = require('thirdparty/lodash');

// TODO: 12/16/2014 - This module requires using an exports object.  Adding
// extra members in this module without using a new object exposes some bug in
// the scripting environment implementation, and nothing will get exported.
// We don't have time to figure out why right now.
exports = {
    pushCallback: function(obj, name, fn) {
        var oldCallback = obj[name];
        var wrapper = function() {
            var oldResult = oldCallback ? oldCallback.apply(this, arguments) : undefined;
            var args = [oldResult];
            for (var a = 0; a < arguments.length; ++a)
                args.push(arguments[a]);
            return fn.apply(this, args);
        };
        wrapper.pop = function() {
            obj[name] = oldCallback;
        };
        obj[name] = wrapper;
    },

    // Convenience wrapper for _.reduce.  Counts callbacks that return "true", or
    // sums a number per item in the collection.
    sum: function(collection, callback) {
        return _.reduce(collection, function(sum, item) {
            var itemResult = callback(item);
            var itemCount;
            if (typeof itemResult === 'number')
                itemCount = itemResult;
            else
                itemCount = (itemResult ? 1 : 0);
            return sum + itemCount;
        }, 0);
    },

    getMinimalSystemDescription: function (system) {
        if (!system)
            return system;

        var copy = _.omit(system, 'planets');
        copy.planets = _.map(system.planets, function (element) {
            var summary = _.omit(element, ['planetCSG', 'landing_zones', 'metal_spots', 'source']);

            summary.metal_spots_count = element.metal_spots ? element.metal_spots.length : 0;
            summary.planetCSG_count = element.planetCSG ? element.planetCSG.length : 0;
            summary.landing_zones_count = element.landing_zones ? ( element.landing_zones.list ? element.landing_zones.list.length : element.landing_zones.length ) : 0;
            return summary;
        });

        return copy;
    },

    // Modulo division, which is not what % does in JS.
    modulo: function(n, m) { return ((n % m) + m) % m; }
};

var random_characters = '1234567890qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM';

var randomString = function(length) {
    var result = '';
    _.times(length, function () {
        var number = Math.floor(Math.random() * random_characters.length);
        result += random_characters.charAt(number);
    });
    return result;
}

exports.randomString = randomString;

exports.createUUIDString = function() {
    return randomString(32);
}