exports.config = {
    paused: false,
    maxClients: 16,
    armies: [
        {
            name: "Red",
            commander: "/pa/units/commanders/imperial_delta/imperial_delta.json",
            primary_color: [210, 50, 44],
            secondary_color: [51, 151, 197],
            econ_rate: 2
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
        name: "Neural Nets",
        planets: [
            {
                name: "Main",
                mass: 1000,
                position: [31104.7, 24.0555],
                velocity: [0.0980473, 126.786],
                generator: {
                    seed: 78462,
                    radius: 650,
                    heightRange: 35,
                    biomeScale: 50,
                    waterHeight: 0,
                    temperature: 0,
                    biome: "moon"
                }
            }
        ]
    }
};
