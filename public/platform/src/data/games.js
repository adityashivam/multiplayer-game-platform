export const gameTitles = {
  fight: "Kaboom Fight",
  pong: "Kaboom Pong",
  roadrash: "Road Rash Online",
};

export const fallbackGames = [
  {
    id: "fight",
    name: "Kaboom Fight",
    description: "Duel with a friend in this 2-player sword fight built with Kaboom.js.",
    path: "/games/fight",
    tags: ["Real-time", "2 players", "Action"],
  },
  {
    id: "pong",
    name: "Kaboom Pong",
    description: "Classic two-player pong with server-run ball physics.",
    path: "/games/pong",
    tags: ["Arcade", "2 players", "Fast"],
  },
  {
    id: "roadrash",
    name: "Road Rash Online",
    description: "Road Rash-inspired two-player bike race with kicks and highway traffic.",
    path: "/games/roadrash",
    tags: ["Racing", "2 players", "Action"],
  },
];

export const visualsByGame = {
  fight: {
    status: "ACTIVE",
    players: "2P",
    icon: "swords",
    art:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuDfFo7xAE8YpsiLcTu8wVB5TDryjICa68MoJz3L_xzevsn28LBYu4SK3yrTg3hfV7txizFKMpVntHcHWxkRR7lFfBgyZ7USU6-Qw5PIWc-ftfLN-bpENLwLkLP7PbwD9CRqiIcuWqXJl_0i2N8BX2nDUkj3ldFNzpMt70L6MGNOhZC-7oyfQKEu8Pd9DVsW-kgl5U9TAQh_6l4vz0xDg7rPGWmB_8uyUuMcwiHLG0MnSeuWkLJMM363GgkHe_dKnRwsbJt9ThPtXU9i",
    featured: true,
  },
  pong: {
    status: "ARCADE",
    players: "2P",
    icon: "sports_tennis",
    art:
      "https://lh3.googleusercontent.com/aida-public/AB6AXuCU-xEUh7OsSfRk3s2Bt77jkrHr-TZvbGTC28QtcnpavWc88RXHY6OpNjB2jXpD_auchl2SDu6xQw1LPd0sXqmc36wOh89AkyKmKIPB31mN9AiBjnMJbykmX4bRMANwHiPtliTIaFF_DDYiuBRPrqropD_hk6DRRmZdowywoFAVGPk8RWx2E_VTmf-dDoAY9R1a3F82Op4wEPZy_d8zQ3Gfc20VPFoEpNZ3ejkpXCuvzpGA0CGPPHSeL7bqOQJHStW6d-dNLmCu995Y",
  },
  roadrash: {
    status: "RACE",
    players: "2P",
    icon: "two_wheeler",
    art: "/games/roadrash/assets/roadrash.png",
  },
};
