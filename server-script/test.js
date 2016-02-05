exports.exampleConfig = {
    type: 0,
    armies: [
        {
            slots: ["player"]
        },
        {
            slots: ["ai"]
        },
        {
            slots: ["ai"]
        },
        {
            slots: ["ai"]
        }
    ],
    system: {
        name: "Test System",
        planets: [
            {
                mass: 3000,
                position: [24000, 0],
                velocity: [0, 219.351],
                generator: {
                    seed: 9689,
                    radius: 500,
                    heightRange: 46,
                    biomeScale: 1,
                    waterHeight: 30,
                    temperature: 77,
                    biome: "earth"
                }
            },
            {
                mass: 1000,
                position: [20000, 0],
                velocity: [0, 158.114],
                generator: {
                    seed: 4931,
                    radius: 300,
                    heightRange: 69,
                    biomeScale: 1,
                    waterHeight: 55,
                    temperature: 82,
                    biome: "lava"
                }
            }
        ]
    },
    enable_lan: true,
    spectators: 0
};
