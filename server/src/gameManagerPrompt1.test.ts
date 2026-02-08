/**
 * Prompt 1.1, 1.2 & 2.1 tests: alive state, turn order, startNewCycle, voting outcome
 * Run: npm run test:gameManager (from server/)
 */
import { gameManager, AI_PLAYER_ID, GamePhase, Role } from './gameManager';

const ROOM = 'PROMPT1_TEST';
const ROOM12 = 'PROMPT12_TEST';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

// --- Prompt 1.1 ---
gameManager.startGame(ROOM, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);

const game = gameManager.getGame(ROOM);
assert(!!game, 'game exists');
assert(Array.isArray(game!.alivePlayerIds), 'alivePlayerIds is array');
assert(game!.alivePlayerIds.length === 4, 'alivePlayerIds has 4 players');
assert(game!.cycleNumber === 1, 'cycleNumber starts at 1');

const alive = gameManager.getAlivePlayerIds(ROOM);
assert(alive.length === 4, 'getAlivePlayerIds returns 4');
assert(alive.includes('p1') && alive.includes('p2') && alive.includes('p3') && alive.includes(AI_PLAYER_ID), 'getAlivePlayerIds contains all 4 IDs');

assert(gameManager.isPlayerAlive(ROOM, 'p1') === true, 'isPlayerAlive(p1) true');
assert(gameManager.isPlayerAlive(ROOM, AI_PLAYER_ID) === true, 'isPlayerAlive(AI) true');
assert(gameManager.isPlayerAlive(ROOM, 'nonexistent') === false, 'isPlayerAlive(nonexistent) false');

gameManager.deleteGame(ROOM);
assert(gameManager.getAlivePlayerIds(ROOM).length === 0, 'after delete, getAlivePlayerIds returns []');

console.log('Prompt 1.1 tests passed.');

// --- Prompt 1.2: description phase for one cycle + startNewCycle ---
gameManager.startGame(ROOM12, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);

const g = gameManager.getGame(ROOM12)!;
assert(g.descriptionTurnOrder.length === 4, 'descriptionTurnOrder has 4 (from alivePlayerIds)');
assert(g.phase === GamePhase.DESCRIPTION, 'phase is DESCRIPTION');

// Turn methods only consider descriptionTurnOrder
const firstTurn = gameManager.getCurrentTurnPlayerId(ROOM12);
assert(firstTurn !== null, 'current turn is set');
assert(g.descriptionTurnOrder.includes(firstTurn!), 'current turn is in descriptionTurnOrder');

let turnCount = 0;
let current: string | null = firstTurn;
while (current) {
  assert(gameManager.submitDescription(ROOM12, current, `desc-${current}`), `submit description for ${current}`);
  current = gameManager.advanceDescriptionTurn(ROOM12);
  turnCount++;
  const soFar = gameManager.getDescriptionsSoFar(ROOM12);
  assert(soFar.length === turnCount, `getDescriptionsSoFar length ${turnCount} after turn ${turnCount}`);
}
assert(turnCount === 4, 'description phase completes for all 4 turns');

// startNewCycle: reset and next cycle
gameManager.advancePhase(ROOM12); // DISCUSSION
gameManager.advancePhase(ROOM12); // VOTING
const g2 = gameManager.getGame(ROOM12)!;
assert(g2.phase === GamePhase.VOTING, 'moved to VOTING');
// Set some votes/descriptions so we can verify reset
for (const pid of g2.alivePlayerIds) {
  const p = g2.players.get(pid);
  if (p) {
    p.voteTarget = 'p1';
    p.hasVoted = true;
  }
}

gameManager.startNewCycle(ROOM12);
const g3 = gameManager.getGame(ROOM12)!;
assert(g3.phase === GamePhase.DESCRIPTION, 'startNewCycle sets phase to DESCRIPTION');
assert(g3.descriptionTurnIndex === 0, 'descriptionTurnIndex reset to 0');
assert(g3.cycleNumber === 2, 'cycleNumber incremented to 2');
assert(g3.descriptionTurnOrder.length === 4, 'descriptionTurnOrder is shuffle of alive (4)');
for (const pid of g3.alivePlayerIds) {
  const p = g3.players.get(pid)!;
  assert(p.description === '', `alive ${pid} description cleared`);
  assert(p.voteTarget === '', `alive ${pid} voteTarget cleared`);
  assert(p.hasSubmittedDescription === false, `alive ${pid} hasSubmittedDescription false`);
  assert(p.hasVoted === false, `alive ${pid} hasVoted false`);
}

gameManager.deleteGame(ROOM12);
console.log('Prompt 1.2 tests passed.');

// --- Prompt 2.1: voting result branching and elimination ---
const ROOM21_UC = 'PROMPT21_UC';   // undercover eliminated
const ROOM21_C2 = 'PROMPT21_C2';   // civilian eliminated, 2+ civilians left -> new cycle
const ROOM21_C1 = 'PROMPT21_C1';   // civilian eliminated, 1 civilian left -> game over

// Case 1: Undercover eliminated -> game over, alivePlayerIds unchanged
gameManager.startGame(ROOM21_UC, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const guc = gameManager.getGame(ROOM21_UC)!;
const undercoverId = Array.from(guc.players.values()).find(p => p.role === Role.UNDERCOVER)!.id;
gameManager.setPhase(ROOM21_UC, GamePhase.VOTING);
for (const pid of guc.alivePlayerIds) {
  gameManager.submitVote(ROOM21_UC, pid, undercoverId);
}
const resUc = gameManager.calculateVotingResults(ROOM21_UC)!;
assert(resUc.outcome === 'game_over', 'undercover eliminated -> outcome game_over');
assert(resUc.civiliansWon === true, 'civilians won');
assert(resUc.eliminatedPlayer?.role === Role.UNDERCOVER, 'eliminated is undercover');
const gucAfter = gameManager.getGame(ROOM21_UC)!;
assert(gucAfter.alivePlayerIds.length === 4, 'alivePlayerIds unchanged when undercover out');
gameManager.deleteGame(ROOM21_UC);

// Case 2: Civilian eliminated, 2+ civilians left -> new cycle
gameManager.startGame(ROOM21_C2, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const gC2 = gameManager.getGame(ROOM21_C2)!;
const civilianId = Array.from(gC2.players.values()).find(p => p.role === Role.CIVILIAN && p.id !== AI_PLAYER_ID)!.id;
gameManager.setPhase(ROOM21_C2, GamePhase.VOTING);
for (const pid of gC2.alivePlayerIds) {
  gameManager.submitVote(ROOM21_C2, pid, civilianId);
}
const resC2 = gameManager.calculateVotingResults(ROOM21_C2)!;
assert(resC2.outcome === 'new_cycle', 'civilian out, 2+ civilians left -> outcome new_cycle');
assert(resC2.civiliansWon === false, 'civilians did not win round');
assert(resC2.eliminatedPlayer?.role === Role.CIVILIAN, 'eliminated is civilian');
const gC2After = gameManager.getGame(ROOM21_C2)!;
assert(gC2After.alivePlayerIds.length === 3, 'alivePlayerIds has 3 after one civilian out');
assert(!gC2After.alivePlayerIds.includes(civilianId), 'eliminated not in alivePlayerIds');
assert(gC2After.phase === GamePhase.DESCRIPTION, 'phase is DESCRIPTION (new cycle)');
assert(gC2After.cycleNumber === 2, 'cycleNumber is 2');
gameManager.deleteGame(ROOM21_C2);

// Case 3: Civilian eliminated, only 1 civilian left (3 alive -> eliminate 1 civilian -> 2 alive: 1 civ, 1 undercover) -> game over
gameManager.startGame(ROOM21_C1, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const gC1 = gameManager.getGame(ROOM21_C1)!;
// First remove one civilian from alive (simulate previous cycle)
const civIds = gC1.alivePlayerIds.filter(pid => gC1.players.get(pid)?.role === Role.CIVILIAN);
gC1.alivePlayerIds = gC1.alivePlayerIds.filter(id => id !== civIds[0]);
assert(gC1.alivePlayerIds.length === 3, 'setup: 3 alive');
gameManager.setPhase(ROOM21_C1, GamePhase.VOTING);
const secondCivId = civIds[1];
for (const pid of gC1.alivePlayerIds) {
  gameManager.submitVote(ROOM21_C1, pid, secondCivId);
}
const resC1 = gameManager.calculateVotingResults(ROOM21_C1)!;
assert(resC1.outcome === 'game_over', 'last civilian out -> outcome game_over');
assert(resC1.civiliansWon === false, 'undercover wins');
const gC1After = gameManager.getGame(ROOM21_C1)!;
assert(gC1After.alivePlayerIds.length === 2, '2 alive: undercover + 0 civilians');
gameManager.deleteGame(ROOM21_C1);

console.log('Prompt 2.1 tests passed.');

// --- Prompt 2.2: Voting tie -> no elimination, new cycle ---
const ROOM22_TIE = 'PROMPT22_TIE';
gameManager.startGame(ROOM22_TIE, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const gTie = gameManager.getGame(ROOM22_TIE)!;
const [pid1, pid2, pid3, pid4] = gTie.alivePlayerIds;
gameManager.setPhase(ROOM22_TIE, GamePhase.VOTING);
// Tie: 2 votes for p1, 2 votes for p2 (e.g. p1->p2, p2->p1, p3->p1, p4->p2 -> p1:2, p2:2)
gameManager.submitVote(ROOM22_TIE, pid1, pid2);
gameManager.submitVote(ROOM22_TIE, pid2, pid1);
gameManager.submitVote(ROOM22_TIE, pid3, pid1);
gameManager.submitVote(ROOM22_TIE, pid4, pid2);
const resTie = gameManager.calculateVotingResults(ROOM22_TIE)!;
assert(resTie.eliminatedPlayer === null, 'tie -> no one eliminated');
assert(resTie.outcome === 'new_cycle', 'tie -> outcome new_cycle');
assert(resTie.civiliansWon === false, 'tie -> civilians did not win');
const gTieAfter = gameManager.getGame(ROOM22_TIE)!;
assert(gTieAfter.alivePlayerIds.length === 4, 'tie -> alivePlayerIds unchanged (4)');
assert(gTieAfter.phase === GamePhase.DESCRIPTION, 'tie -> phase DESCRIPTION');
assert(gTieAfter.cycleNumber === 2, 'tie -> cycleNumber incremented to 2');
for (const pid of gTieAfter.alivePlayerIds) {
  const p = gTieAfter.players.get(pid)!;
  assert(p.description === '', `tie new cycle: ${pid} description cleared`);
  assert(p.voteTarget === '', `tie new cycle: ${pid} voteTarget cleared`);
  assert(p.hasSubmittedDescription === false, `tie new cycle: ${pid} hasSubmittedDescription false`);
  assert(p.hasVoted === false, `tie new cycle: ${pid} hasVoted false`);
}
gameManager.deleteGame(ROOM22_TIE);
console.log('Prompt 2.2 tests passed.');

// --- Prompt 3.1: Reject actions from eliminated players ---
const ROOM31 = 'PROMPT31_TEST';
gameManager.startGame(ROOM31, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const g31 = gameManager.getGame(ROOM31)!;
const elimId = g31.alivePlayerIds.find(id => g31.players.get(id)?.role === Role.CIVILIAN)!;
g31.alivePlayerIds = g31.alivePlayerIds.filter(id => id !== elimId);
assert(g31.alivePlayerIds.length === 3, 'setup: eliminated one player');

gameManager.setPhase(ROOM31, GamePhase.DESCRIPTION);
assert(gameManager.submitDescription(ROOM31, elimId, 'test') === false, 'submitDescription rejected for eliminated player');

gameManager.setPhase(ROOM31, GamePhase.DISCUSSION);
gameManager.setPhase(ROOM31, GamePhase.VOTING);
assert(gameManager.submitVote(ROOM31, elimId, g31.alivePlayerIds[0]) === false, 'submitVote rejected for eliminated voter');
assert(gameManager.submitVote(ROOM31, g31.alivePlayerIds[0], elimId) === false, 'submitVote rejected when voting for eliminated target');

gameManager.deleteGame(ROOM31);
console.log('Prompt 3.1 tests passed.');

// --- Prompt 3.2: AI does not act when eliminated ---
const ROOM32 = 'PROMPT32_TEST';
gameManager.startGame(ROOM32, [
  { id: 'p1', name: 'Alice' },
  { id: 'p2', name: 'Bob' },
  { id: 'p3', name: 'Carol' },
]);
const g32 = gameManager.getGame(ROOM32)!;
// Simulate: AI (civilian) voted out -> new cycle with 3 humans
g32.alivePlayerIds = g32.alivePlayerIds.filter(id => id !== AI_PLAYER_ID);
gameManager.startNewCycle(ROOM32);
const g32After = gameManager.getGame(ROOM32)!;
assert(!gameManager.isPlayerAlive(ROOM32, AI_PLAYER_ID), 'AI is not alive');
assert(g32After.descriptionTurnOrder.length === 3, 'descriptionTurnOrder has 3 players (no AI)');
assert(!g32After.descriptionTurnOrder.includes(AI_PLAYER_ID), 'AI not in descriptionTurnOrder');
gameManager.deleteGame(ROOM32);
console.log('Prompt 3.2 tests passed.');
process.exit(0);
