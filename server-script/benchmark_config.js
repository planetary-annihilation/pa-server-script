exports.config = {
    paused: false,
    maxClients: 16,
    armies: [
        {
            name: "SkyNet 1",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [210, 50, 44],
            secondary_color: [51, 151, 197],
            econ_rate: 1
        },
        {
            name: "SkyNet 2",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [182, 54, 182],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 3",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [59, 54, 182],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 4",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [59, 182, 182],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 5",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [59, 182, 54],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 6",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [182, 182, 59],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 7",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [59, 54, 54],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        },
        {
            name: "SkyNet 8",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [182, 182, 182],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        }

    ],
    system: {
           name: "Battlefield System",
           description: "8-10 Players",
           planets: [
              {
                  name: "Syracuse",
                  starting_planet: false,
                  mass: 50000,
                  position: [21145.921875, 35367.453125],
                  velocity: [-94.54401397705078, 56.526885986328125],
                  required_thrust_to_move: 0,
                  generator: {
                      seed: 24029,
                      radius: 710,
                      heightRange: 10,
                      waterHeight: 37,
                      temperature: 95,
                      metalDensity: 82,
                      metalClusters: 60,
                      biomeScale: 100,
                      biome: "metal"
                  }
              },
              {
                  name: "Napalm",
                  starting_planet: false,
                  mass: 5000,
                  position: [33248.1015625, 40114.4453125],
                  velocity: [-145.18154907226562, 185.6262664794922],
                  required_thrust_to_move: 2,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 0,
                      temperature: 0,
                      metalDensity: 10,
                      metalClusters: 30,
                      biomeScale: 100,
                      biome: "moon"
                  }
              },
              {
                  name: "V2",
                  starting_planet: false,
                  mass: 5000,
                  position: [25795.56640625, 23227.18359375],
                  velocity: [34.95726776123047, 106.12570190429688],
                  required_thrust_to_move: 2,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 0,
                      temperature: 0,
                      metalDensity: 10,
                      metalClusters: 10,
                      biomeScale: 100,
                      biome: "moon"
                  }
              },
              {
                  name: "Culverin",
                  starting_planet: false,
                  mass: 5000,
                  position: [9042.2744140625, 30623.541015625],
                  velocity: [-43.9383544921875, -72.58448791503906],
                  required_thrust_to_move: 2,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 0,
                      temperature: 0,
                      metalDensity: 10,
                      metalClusters: 10,
                      biomeScale: 100,
                      biome: "moon"
                  }
              },
              {
                  name: "Morning Star",
                  starting_planet: false,
                  mass: 5000,
                  position: [16310.9365234375, 47435.48828125],
                  velocity: [-223.26882934570312,4.9534759521484375],
                  required_thrust_to_move: 2,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 0,
                      temperature: 0,
                      metalDensity: 10,
                      metalClusters: 10,
                      biomeScale: 100,
                      biome: "moon"
                  }
              },
              {
                  name: "Tizona",
                  starting_planet: true,
                  mass: 5000,
                  position: [32692.984375, 48754.07421875],
                  velocity: [-184.58935546875, 134.19984436035156],
                  required_thrust_to_move: 0,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 46,
                      temperature: 100,
                      metalDensity: 30,
                      metalClusters: 30,
                      biomeScale: 100,
                      biome: "tropical"
                  }
              },
              {
                  name: "Joyeuse",
                  starting_planet: true,
                  mass: 5000,
                  position: [33928.65625, 23136.615234375],
                  velocity: [-12.362159729003906, 142.41769409179688],
                  required_thrust_to_move: 0,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 50,
                      temperature: 0,
                      metalDensity: 30,
                      metalClusters: 30,
                      biomeScale: 100,
                      biome: "earth"
                  }
              },
              {
                  name: "Arbalest",
                  starting_planet: true,
                  mass: 5000,
                  position: [9795.900390625, 21808.18359375],
                  velocity: [-3.3668212890625, -19.79387664794922],
                  required_thrust_to_move: 0,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 20,
                      temperature: 100,
                      metalDensity: 30,
                      metalClusters: 30,
                      biomeScale: 100,
                      biome: "desert"
                  }
              },
              {
                  name: "Gatling",
                  starting_planet: true,
                  mass: 5000,
                  position: [7785.6845703125, 46828.9296875],
                  velocity: [-172.23602294921875, -34.005950927734375],
                  required_thrust_to_move: 0,
                  generator: {
                      seed: 11468,
                      radius: 450,
                      heightRange: 11,
                      waterHeight: 45,
                      temperature: 63,
                      metalDensity: 30,
                      metalClusters: 30,
                      biomeScale: 100,
                      biome: "lava"
                    }
                },
            ]
        }
};
