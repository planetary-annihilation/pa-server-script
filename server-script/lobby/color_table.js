var _ = require('thirdparty/lodash');

function rgbToHsv( r,g,b )
{
    r = r / 255;
    g = g / 255;
    b = b / 255;
    var minRGB = Math.min( r,g, b );
    var maxRGB = Math.max( r,g,b );
    var v = maxRGB;
    var delta = maxRGB - minRGB;
    var s = v ? delta / v : 0;
    var h;
    if (maxRGB == minRGB) {
        h = 0;
    } else {
        switch( maxRGB ) {
            case r: h = ( g - b ) / delta + ( g < b ? 6 : 0 ); break;
            case g: h = ( b - r ) / delta + 2; break;
            case b: h = ( r - g ) / delta + 4; break;
        }
        h = h / 6 * 360;
    }
    return { h: h, s: s, v: v };
}

function shvColourSort(colours) {
    var result = _.sortBy(colours, function(colour) {
        var hsv = rgbToHsv(colour[0], colour[1], colour[2] );
        var sort = hsv.s.toString(16) + hsv.h.toString(16) + hsv.v.toString(16);
        return sort;
    })
    return result;
}

var                 uberRed = [210, 50, 44];
var                uberPink = [206, 51,122];
var              uberPurple = [113, 52,165];
var            uberDarkBlue = [ 59, 54,182];
var          uberMediumBlue = [ 51,151,197];
var               uberGreen = [ 83,119, 48];
var              uberYellow = [219,217, 37];
var               uberBrown = [142,107, 68];
var              uberOrange = [255,144, 47];
var           uberLightGray = [200,200,200];
var            uberDarkGray = [ 70, 70, 70];

var uberColours = [uberRed, uberPink, uberPurple, uberDarkBlue, uberMediumBlue, uberGreen, uberYellow, uberBrown, uberOrange, uberLightGray, uberDarkGray];

var              redCSS3x11 = [255,  0,  0];
var   magentaFuchsiaCSS3x11 = [255,  0,255];
var             blueCSS3x11 = [  0,  0,255];
var             limeCSS3x11 = [  0,255,  0];
var             aquaCSS3x11 = [  0,255,255];
var             tealCSS3x11 = [  0,128,128];
var           maroonCSS3x11 = [128,  0,  0];
var           purpleCSS3x11 = [128,  0,128];
var         deepPinkCSS3x11 = [255, 20,147];
var          hotPinkCSS3x11 = [255,105,180];
var     mediumPurpleCSS3x11 = [147,122,219];
var       powderBlueCSS3x11 = [176,224,230];
var   cornflowerBlueCSS3x11 = [100,149,237];
var        paleGreenCSS3x11 = [151,251,152];
var              tanCSS3x11 = [210,180,140];
var      lightSalmonCSS3x11 = [255,160,122];
var     mediumOrchidCSS3x11 = [186, 85,211];
var       sadleBrownCSS3x11 = [139, 69, 19];
var     darkSeaGreenCSS3x11 = [143,188,143];
var        darkGreenCSS3x11 = [  0,100,  0];
var             pinkCSS3x11 = [255,192,203];
var        lightPinkCSS3x11 = [255,182,193];

var CSS3x11colours = [maroonCSS3x11, redCSS3x11,  hotPinkCSS3x11, deepPinkCSS3x11, magentaFuchsiaCSS3x11, mediumPurpleCSS3x11, tealCSS3x11, darkSeaGreenCSS3x11, darkGreenCSS3x11, aquaCSS3x11, limeCSS3x11, blueCSS3x11, powderBlueCSS3x11, cornflowerBlueCSS3x11, paleGreenCSS3x11, tanCSS3x11, purpleCSS3x11, mediumOrchidCSS3x11, lightSalmonCSS3x11, sadleBrownCSS3x11, pinkCSS3x11];

var brightnessAdjustment = 14/16;

CSS3x11colours = _.map(CSS3x11colours,function(colour) {

    var r = colour[0];
    var g = colour[1];
    var b = colour[2];

    if ( r == 255 || g == 255 || b == 255 ) {
        r = Math.round(r * brightnessAdjustment);
        g = Math.round(g * brightnessAdjustment);
        b = Math.round(b * brightnessAdjustment);
    }

    return [r, g, b];
});


var colours = shvColourSort(uberColours.concat(CSS3x11colours));

exports.data = _.map(colours, function(colour) {
    var result = { primary: colour, secondary: colours };
    return result;
});
