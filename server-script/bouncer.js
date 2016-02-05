var _ = require('thirdparty/lodash');

var bouncer = {
    modlist: {},
    whitelist: {},
    blacklist: {},
    password: '',
    uuid: ''
}

function useWhiteList() {
    return !_.isEmpty(bouncer.whitelist);
}

function useBlackList() {
    return !_.isEmpty(bouncer.blacklist);
}

function usePassword() {
    return !_.isEmpty(bouncer.password);
}

function useUUID() {
    return !_.isEmpty(bouncer.uuid);
}

exports.addPlayerToModlist = function (id) {
    bouncer.modlist[id] = true;
}

exports.removePlayerFromModlist = function (id) {
    delete bouncer.modlist[id];
}

exports.clearModlist = function() {
    bouncer.modlist = {};
}

exports.addPlayerToBlacklist = function (id) {
    bouncer.blacklist[id] = true;
}

exports.removePlayerFromBlacklist = function (id) {
    delete bouncer.blacklist[id];
}

exports.clearBlacklist = function() {
    bouncer.blacklist = {};
}

exports.addPlayerToWhitelist = function (id) {
    bouncer.whitelist[id] = true;
}

exports.removePlayerFromWhitelist = function (id) {
    delete bouncer.whitelist[id];
}

exports.clearWhitelist = function() {
    bouncer.whitelist = {};
}

exports.setPassword = function (password) {
    bouncer.password = _.isString(password) ? password : '';
}

exports.setUUID = function (uuid) {
    if (uuid)
        bouncer.uuid = _.isString(uuid) ? uuid : '';
}

exports.isPlayerMod = function (id) {
    return bouncer.modlist[id];
}

exports.isPlayerValid = function (id, password, uuid, allow_by_default) {

    if (bouncer.modlist[id])
        return true;

    if (useUUID() && uuid === bouncer.uuid)
        return true;

    if (useBlackList() && bouncer.blacklist[id])
        return false;

    if (usePassword() && password !== bouncer.password)
        return false;

    if (useWhiteList() && bouncer.whitelist[id])
        return true;

    return !!allow_by_default;
}

exports.isGamePrivate = function () {
    return usePassword() || useWhiteList();
}

exports.doesGameRequirePassword = function () {
    return usePassword();
}

exports.getWhitelist = function () {
    return Object.keys(bouncer.whitelist);
}

exports.getBlacklist = function () {
    return Object.keys(bouncer.blacklist);
}