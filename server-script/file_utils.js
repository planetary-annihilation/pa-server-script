var file = require('file');
var Q = require('thirdparty/q');
var _ = require('thirdparty/lodash');

exports.loadAsync = function(f) {
    var d = Q.defer();
    file.load(f, function(data) {
        d.resolve(data);
    });
    return d.promise;
};

exports.loadJsonAsync = function(f) {
    return exports.loadAsync(f).then(JSON.parse);
};


function log(object) {
    console.log(JSON.stringify(object,null,'\t'));
}

exports.loadJsonBlocking = function(f) {
    var data = file.loadBlocking(f);
    if (!_.isString(data))
        return null;
    try {
        return JSON.parse(data);
    } catch (error) {
        log("Unable to parse file data as JSON");
        log(error);
        log({ file: f, data: data });
        return null;
    }
};
