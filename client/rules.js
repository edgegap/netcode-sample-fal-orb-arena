// Orb Arena rules. Written by fal Agent; the browser (solo) and the Edgegap server (online)
// both import this file, so the rules can't drift apart. No DOM, canvas, audio or timers here.
const ARENA_SIZE = 800;
const SHIP_RADIUS = 18;
const PROJECTILE_RADIUS = 5;
const PROJECTILE_SPEED = 420;
const PROJECTILE_LIFETIME = 1.5;
const FIRE_COOLDOWN = 0.4;
const WIN_SCORE = 10;

export { ARENA_SIZE, WIN_SCORE };

const CORNERS = [
  { x: 60, y: 60 },
  { x: ARENA_SIZE - 60, y: 60 },
  { x: 60, y: ARENA_SIZE - 60 },
  { x: ARENA_SIZE - 60, y: ARENA_SIZE - 60 },
];

function emptyInput() {
  return {
    up: false,
    down: false,
    left: false,
    right: false,
    aimX: ARENA_SIZE / 2,
    aimY: ARENA_SIZE / 2,
    fire: false,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function respawn(player) {
  const corner = CORNERS[Math.floor(Math.random() * CORNERS.length)];
  player.x = corner.x;
  player.y = corner.y;
  player.vx = 0;
  player.vy = 0;
  player.invulnerable = 1;
}

export function createWorld() {
  return {
    width: ARENA_SIZE,
    height: ARENA_SIZE,
    players: {},
    inputs: {},
    projectiles: [],
    nextProjectileId: 1,
    winner: null,
  };
}

export function addPlayer(world, id, name, isBot) {
  const existingCount = Object.keys(world.players).length;
  const spawn = CORNERS[existingCount % CORNERS.length];

  const player = {
    id,
    name,
    isBot: Boolean(isBot),
    x: spawn.x,
    y: spawn.y,
    vx: 0,
    vy: 0,
    radius: SHIP_RADIUS,
    score: 0,
    invulnerable: 0,
    fireCooldown: 0,
  };

  world.players[id] = player;
  world.inputs[id] = emptyInput();
  return player;
}

export function removePlayer(world, id) {
  delete world.players[id];
  delete world.inputs[id];
  world.projectiles = world.projectiles.filter((projectile) => projectile.shooter !== id);

  if (world.winner === id) {
    world.winner = null;
  }
}

export function setInput(world, id, input) {
  if (!world.players[id]) return;

  const current = world.inputs[id] || emptyInput();
  world.inputs[id] = {
    up: Boolean(input.up),
    down: Boolean(input.down),
    left: Boolean(input.left),
    right: Boolean(input.right),
    aimX: Number.isFinite(input.aimX) ? input.aimX : current.aimX,
    aimY: Number.isFinite(input.aimY) ? input.aimY : current.aimY,
    fire: Boolean(input.fire),
  };
}

export function botInput(world, id) {
  const bot = world.players[id];
  if (!bot) return emptyInput();

  let target = null;
  let nearestDistanceSquared = Infinity;

  for (const player of Object.values(world.players)) {
    if (player.id === id) continue;

    const dx = player.x - bot.x;
    const dy = player.y - bot.y;
    const distanceSquared = dx * dx + dy * dy;

    if (distanceSquared < nearestDistanceSquared) {
      nearestDistanceSquared = distanceSquared;
      target = player;
    }
  }

  if (!target) return emptyInput();

  const dx = target.x - bot.x;
  const dy = target.y - bot.y;
  const distance = Math.hypot(dx, dy) || 1;

  // Keep some distance while steering toward the nearest opponent.
  const movementDistance = distance > 220 ? 1 : distance < 130 ? -1 : 0;
  const moveX = (dx / distance) * movementDistance;
  const moveY = (dy / distance) * movementDistance;

  return {
    up: moveY < -0.25,
    down: moveY > 0.25,
    left: moveX < -0.25,
    right: moveX > 0.25,
    aimX: target.x,
    aimY: target.y,
    fire: true,
  };
}

export function step(world, dt) {
  const events = [];
  if (world.winner) return events;

  const safeDt = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.1);
  const acceleration = 700;
  const maxSpeed = 230;
  const friction = Math.exp(-4.2 * safeDt);

  for (const player of Object.values(world.players)) {
    const input = world.inputs[player.id] || emptyInput();

    player.fireCooldown = Math.max(0, player.fireCooldown - safeDt);
    player.invulnerable = Math.max(0, player.invulnerable - safeDt);

    let moveX = Number(input.right) - Number(input.left);
    let moveY = Number(input.down) - Number(input.up);
    const moveLength = Math.hypot(moveX, moveY);

    if (moveLength > 0) {
      moveX /= moveLength;
      moveY /= moveLength;
      player.vx += moveX * acceleration * safeDt;
      player.vy += moveY * acceleration * safeDt;
    }

    player.vx *= friction;
    player.vy *= friction;

    const speed = Math.hypot(player.vx, player.vy);
    if (speed > maxSpeed) {
      player.vx = (player.vx / speed) * maxSpeed;
      player.vy = (player.vy / speed) * maxSpeed;
    }

    player.x += player.vx * safeDt;
    player.y += player.vy * safeDt;

    const min = player.radius;
    const maxX = world.width - player.radius;
    const maxY = world.height - player.radius;

    if (player.x < min) {
      player.x = min;
      player.vx = Math.max(0, player.vx);
    } else if (player.x > maxX) {
      player.x = maxX;
      player.vx = Math.min(0, player.vx);
    }

    if (player.y < min) {
      player.y = min;
      player.vy = Math.max(0, player.vy);
    } else if (player.y > maxY) {
      player.y = maxY;
      player.vy = Math.min(0, player.vy);
    }

    if (input.fire && player.fireCooldown <= 0) {
      const aimDx = input.aimX - player.x;
      const aimDy = input.aimY - player.y;
      const aimLength = Math.hypot(aimDx, aimDy);

      if (aimLength > 0) {
        world.projectiles.push({
          id: world.nextProjectileId++,
          shooter: player.id,
          x: player.x + (aimDx / aimLength) * (player.radius + 6),
          y: player.y + (aimDy / aimLength) * (player.radius + 6),
          vx: (aimDx / aimLength) * PROJECTILE_SPEED,
          vy: (aimDy / aimLength) * PROJECTILE_SPEED,
          life: PROJECTILE_LIFETIME,
        });
        player.fireCooldown = FIRE_COOLDOWN;
      }
    }
  }

  const remainingProjectiles = [];

  for (const projectile of world.projectiles) {
    projectile.x += projectile.vx * safeDt;
    projectile.y += projectile.vy * safeDt;
    projectile.life -= safeDt;

    const outOfBounds =
      projectile.x < 0 || projectile.x > world.width || projectile.y < 0 || projectile.y > world.height;

    if (projectile.life <= 0 || outOfBounds) continue;

    let hit = false;

    for (const victim of Object.values(world.players)) {
      if (victim.id === projectile.shooter || victim.invulnerable > 0) continue;

      const dx = victim.x - projectile.x;
      const dy = victim.y - projectile.y;
      const hitDistance = victim.radius + PROJECTILE_RADIUS;

      if (dx * dx + dy * dy <= hitDistance * hitDistance) {
        const shooter = world.players[projectile.shooter];

        if (shooter) {
          shooter.score += 1;
          events.push({
            type: "hit",
            shooter: shooter.id,
            victim: victim.id,
          });

          respawn(victim);

          if (shooter.score >= WIN_SCORE) {
            world.winner = shooter.id;
            events.push({ type: "win", winner: shooter.id });
          }
        }

        hit = true;
        break;
      }
    }

    if (!hit && !world.winner) {
      remainingProjectiles.push(projectile);
    }

    if (world.winner) break;
  }

  world.projectiles = world.winner ? [] : remainingProjectiles;
  return events;
}
