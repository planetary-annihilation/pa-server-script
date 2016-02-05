exports.config = {
    paused: false,
    maxClients: 16,
    armies: [
        {
            name: "Red",
            ai: false,
            primary_color: [210, 50, 44],
            secondary_color: [51, 151, 197],
            color_index: 0,
            alliance_group: 0,
            econ_rate: 1,
            personality: {}
        },
        {
            name: "Blue",
            ai: true,
            primary_color: [59, 54, 182],
            secondary_color: [219, 217, 37],
            color_index: 1,
            alliance_group: 0,
            econ_rate: 1,
            personality: {}
        }
    ],
    system: {
        name: "Sandbox System",
        planets: [
            {
                mass: 1000,
                position: [20000, 0],
                velocity: [0, 158.114],
                generator: {
                    seed: 6283185,
                    radius: 200,
                    heightRange: 25,
                    biomeScale: 1,
                    waterHeight: 50,
                    temperature: 0,
                    biome: "sandbox"
                }
            }
        ]
    }
};
