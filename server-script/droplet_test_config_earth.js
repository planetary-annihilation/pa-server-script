exports.config = {
    paused: false,
    maxClients: 16,
    armies: [
        {
            name: "Red",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [210, 50, 44],
            secondary_color: [51, 151, 197],
            econ_rate: 1
        },
        {
            name: "Blue",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [59, 54, 182],
            secondary_color: [219, 217, 37],
            econ_rate: 1
        }
    ],
    system: {
        name: "Droplet Test Earth System",
        planets: [
            {
                name: "Earth Planet",
                mass: 1000,
                starting_planet: true,
                position: [20000, 0],
                velocity: [0, 158.114],
                generator: {
                    seed: 31541,
                    radius: 500,
                    heightRange: 35,
                    biomeScale: 1,
                    waterHeight: 34,
                    temperature: 50,
                    biome: "earth"
                }
            }
        ]
    }
};
