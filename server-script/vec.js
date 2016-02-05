/* Vector math library  (Gameish 2-4 dimension linear algebra)
 * 
 * Currently processes vectors in raw array format.  Use of parseN/makeN 
 * functions are advised in case the format changes to structures or something 
 * else.  (e.g. Float32Array support is available.)
 */

var _ = require('thirdparty/lodash');

/* Make a new vector of a given size.  */
function make2(x, y) { 
    var result = new Array(2);
    result[0] = x;
    result[1] = y;
    return result;
};
function make3(x, y, z) { 
    var result = new Array(3);
    result[0] = x;
    result[1] = y;
    result[2] = z;
    return result;
};
function make4(x, y, z, w) { 
    var result = new Array(4);
    result[0] = x;
    result[1] = y;
    result[2] = z;
    result[3] = w;
    return result;
};

/* Scalar expansion */
function expand2(n) { return make2(n, n); };
function expand3(n) { return make3(n, n, n); };
function expand4(n) { return make4(n, n, n, n); };

/* Constants */
var zero2 = make2(0, 0);
var zero3 = make3(0, 0, 0);
var zero4 = make4(0, 0, 0, 0);
var one2 = make2(1, 1);
var one3 = make3(1, 1, 1);
var one4 = make4(1, 1, 1, 1);

/* Function appropriate for processing an unknown object into a format 
 * compatible with this library.  Returns undefined on invalid inputs.
 */
function parse2(obj) {
    if (!obj)
        return;
    if (typeof(obj) === 'string') {
        obj = _.map(obj.split(','), function(e) { return parseFloat(e); });
    }
    if (_.isArray(obj)) {
        if (obj.length < 2)
            return;
        return make2(obj[0], obj[1]);
    }
    if (typeof(obj) === 'object') {
        if (!obj.hasOwnProperty('x') || !obj.hasOwnProperty('y'))
            return;
        return make2(obj.x, obj.y);
    }
};
function parse3(obj) {
    if (!obj)
        return;
    if (typeof(obj) === 'string') {
        obj = _.map(obj.split(','), function(e) { return parseFloat(e); });
    }
    if (_.isArray(obj)) {
        if (obj.length < 3)
            return;
        return make3(obj[0], obj[1], obj[2]);
    }
    if (typeof(obj) === 'object') {
        if (!obj.hasOwnProperty('x') || !obj.hasOwnProperty('y') || !obj.hasOwnProperty('z'))
            return;
        return make3(obj.x, obj.y, obj.z);
    }
};
function parse4(obj) {
    if (!obj)
        return;
    if (typeof(obj) === 'string') {
        obj = _.map(obj.split(','), function(e) { return parseFloat(e); });
    }
    if (_.isArray(obj)) {
        if (obj.length < 4)
            return;
        return make4(obj[0], obj[1], obj[2], obj[3]);
    }
    if (typeof(obj) === 'object') {
        if (!obj.hasOwnProperty('x') || !obj.hasOwnProperty('y') || !obj.hasOwnProperty('z') || !obj.hasOwnProperty('w'))
            return;
        return make4(obj.x, obj.y, obj.z, obj.w);
    }
};

// General ops
function add2(a, b) { return make3(a[0] + b[0], a[1] + b[1]); };
function add3(a, b) { return make3(a[0] + b[0], a[1] + b[1], a[2] + b[2]); };
function add4(a, b) { return make3(a[0] + b[0], a[1] + b[1], a[2] + b[2], a[3] + b[3]); };
function sub2(a, b) { return make3(a[0] - b[0], a[1] - b[1]); };
function sub3(a, b) { return make3(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
function sub4(a, b) { return make3(a[0] - b[0], a[1] - b[1], a[2] - b[2], a[3] - b[3]); };
function mul2(a, b) { return make3(a[0] * b[0], a[1] * b[1]); };
function mul3(a, b) { return make3(a[0] * b[0], a[1] * b[1], a[2] * b[2]); };
function mul4(a, b) { return make3(a[0] * b[0], a[1] * b[1], a[2] * b[2], a[3] * b[3]); };
function div2(a, b) { return make3(a[0] / b[0], a[1] / b[1]); };
function div3(a, b) { return make3(a[0] / b[0], a[1] / b[1], a[2] / b[2]); };
function div4(a, b) { return make3(a[0] / b[0], a[1] / b[1], a[2] / b[2], a[3] / b[3]); };
function neg2(a) { return make3(-a[0], -a[1]); };
function neg3(a) { return make3(-a[0], -a[1], -a[2]); };
function neg4(a) { return make3(-a[0], -a[1], -a[2], -a[3]); };
function inv2(a) { return make3(1 / a[0], 1 / a[1]); };
function inv3(a) { return make3(1 / a[0], 1 / a[1], 1 / a[2]); };
function inv4(a) { return make3(1 / a[0], 1 / a[1], 1 / a[2], 1 / a[3]); };

function dot2(a, b) { return a[0] * b[0] + a[1] * b[1]; };
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; };
function dot4(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]; };
function length2(a) { return Math.sqrt(dot2(a, a)); };
function length3(a) { return Math.sqrt(dot3(a, a)); };
function length4(a) { return Math.sqrt(dot4(a, a)); };

function distSqr2(a, b) { var offset = sub2(a, b); return dot2(offset, offset); };
function distSqr3(a, b) { var offset = sub3(a, b); return dot3(offset, offset); };
function distSqr4(a, b) { var offset = sub4(a, b); return dot4(offset, offset); };
function dist2(a, b) { return Math.sqrt(distSqr2(a, b)); };
function dist3(a, b) { return Math.sqrt(distSqr3(a, b)); };
function dist4(a, b) { return Math.sqrt(distSqr4(a, b)); };

function cross3(a, b) { 
    return make3(
        a[2] * b[3] - a[3] * b[2],
        a[3] * b[0] - a[0] * b[3],
        a[0] * b[1] - a[1] * b[0]
    ); 
};

exports.make2 = make2;
exports.make3 = make3;
exports.make4 = make4;

exports.expand2 = expand2;
exports.expand3 = expand3;
exports.expand4 = expand4;

exports.zero2 = zero2;
exports.zero3 = zero3;
exports.zero4 = zero4;
exports.one2 = one2;
exports.one3 = one3;
exports.one4 = one4;

exports.parse2 = parse2;
exports.parse3 = parse3;
exports.parse4 = parse4;

exports.add2 = add2;
exports.add3 = add3;
exports.add4 = add4;
exports.sub2 = sub2;
exports.sub3 = sub3;
exports.sub4 = sub4;
exports.mul2 = mul2;
exports.mul3 = mul3;
exports.mul4 = mul4;
exports.div2 = div2;
exports.div3 = div3;
exports.div4 = div4;
exports.neg2 = neg2;
exports.neg3 = neg3;
exports.neg4 = neg4;
exports.inv2 = inv2;
exports.inv3 = inv3;
exports.inv4 = inv4;

exports.dot2 = dot2;
exports.dot3 = dot3;
exports.dot4 = dot4;
exports.length2 = length2;
exports.length3 = length3;
exports.length4 = length4;

exports.distSqr2 = distSqr2;
exports.distSqr3 = distSqr3;
exports.distSqr4 = distSqr4;
exports.dist2 = dist2;
exports.dist3 = dist3;
exports.dist4 = dist4;

exports.cross3 = cross3;
