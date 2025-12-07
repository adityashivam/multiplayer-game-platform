const grid = document.getElementById("game-grid");

const fallbackGames = [
  {
    id: "fight",
    name: "Kaboom Fight",
    description:
      "Duel with a friend in this 2-player sword fight built with Kaboom.js.",
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
];

async function fetchGames() {
  try {
    const res = await fetch("/api/games");
    if (!res.ok) throw new Error("Bad response");
    const data = await res.json();
    if (Array.isArray(data.games) && data.games.length) {
      return data.games;
    }
  } catch (err) {
    console.warn("Falling back to default games list", err);
  }
  return fallbackGames;
}

function renderGameCard(game) {
  const card = document.createElement("div");
  card.className = "card";

  const tags =
    Array.isArray(game.tags) && game.tags.length ? game.tags : ["Multiplayer"];

  card.innerHTML = `
    <div class="tag-row">
      ${tags.map((tag) => `<span class="tag">${tag}</span>`).join("")}
    </div>
    <h3>${game.name}</h3>
    <p>${game.description}</p>
  `;

  // Navigate to the game's path when clicking the card
  card.addEventListener("click", () => {
    window.location.href = game.path;
  });

  return card;
}

async function bootstrap() {
  if (!grid) return;
  const games = await fetchGames();
  grid.innerHTML = "";
  games.forEach((game) => {
    grid.appendChild(renderGameCard(game));
  });
}

bootstrap();
