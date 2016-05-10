var _ = require('thirdparty/lodash');

function ColorManager() {
    var self = this;

    self.colors = require('lobby/color_table').data.slice();
    _.forEach(self.colors, function (c, index) {
        c.taken = false;
        c.index = index;
    });

    self.getNumberOfColors = function() { return self.colors.length; };

    self.takeFirstAvailableColorIndex = function() {
        var color_index = _.findIndex(colors, function (element) {
            return !element.taken;
        });
        self.colors[color_index].taken = true;
        return color_index;
    };

    self.takeRandomAvailableColorIndex = function () {

        var available = _.filter(self.colors, function (element) {
            return !element.taken;
        });

        var color_index = _.sample(available).index;
        self.colors[color_index].taken = true;
        return color_index;
    };

    self.takeNextAvailableColorIndex = function(color_index) {

        var next_index = -1;
        _.forEach(self.colors, function (element, index) {
            if (!element.taken && index > color_index) {
                next_index = index;
                return false;
            }
        });

        if (next_index === -1) {
            _.forEach(self.colors, function (element, index) {
                if (!element.taken && index < color_index) {
                    next_index = index;
                    return false;
                }
            });
        }

        if (next_index !== -1)
            self.colors[next_index].taken = true;

        return next_index;
    }

    self.returnColorIndex = function(color_index) {
        if (!self.colors[color_index])
            return;

        self.colors[color_index].taken = false;
    };

    self.maybeGetNewColorIndex = function(old_index, new_index) {
        var target = new_index || 0;

        if (!self.colors[target])
            return old_index;

        if (self.colors[target].taken)
            return old_index;

        if (self.colors[old_index])
            self.colors[old_index].taken = false;
        self.colors[target].taken = true;

        return target;
    }

    self.getColorFor = function(color_indices) {

        if (color_indices[0] === -1)
            return null;

        return [
            self.colors[color_indices[0]].primary,
            self.colors[color_indices[0]].secondary[color_indices[1]]
        ];
    };

    self.getSecondaryColorsFor = function (color_index) {

        if (color_index < 0)
            return [];

        return self.colors[color_index].secondary;
    };

    self.getRandomSecondaryColorIndexFor = function (color_index) {

        if (color_index < 0)
            return -1;

        return _.random(self.colors[color_index].secondary.length - 1);
    };

    self.getNextSecondaryColorIndexFor = function(primary_index, secondary_index) {

        if (primary_index < 0)
            return -1;

        return (secondary_index + 1) % self.getSecondaryColorsFor(primary_index).length;
    }

    self.takeRandomAvailableColor = function () {

        var available = _.filter(self.colors, function (element) {
            return !element.taken;
        });

        var primary = _.sample(available).index;
        var secondary = _.random(self.getSecondaryColorsFor(primary).length - 1);

        self.colors[primary].taken = true;

        return [primary, secondary];
    };

    var isValidIndex = function (index) {
        if (!_.isNumber(index))
            return false;

        return true;
    };

    self.isValidPrimaryColorIndex = function (index) {

        if (!isValidIndex(index))
            return false;

        if (index < 0 || index >= self.colors.length)
            return false;

        return true;
    };

     self.isValidColorPair = function (primary_index, secondary_index) {

        if (!self.isValidPrimaryColorIndex(primary_index))
            return;

        if (!isValidIndex(secondary_index))
            return false;

        if (secondary_index < 0 || secondary_index >= self.colors[primary_index].secondary.length)
            return false;

        return true;
    };
};

exports.ColorManager = ColorManager;
