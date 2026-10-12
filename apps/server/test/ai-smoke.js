// Bounded live check of Ollama narration. Run directly with node after building
// shared + server. Exits non-zero only on unexpected crashes; fallbacks are OK.

async function main() {
  const { OllamaClient } = require('../dist/ai/ollama.client');
  const { AiGameMasterService } = require('../dist/ai/ai-game-master.service');
  const client = new OllamaClient();
  const available = await client.isAvailable(2000);
  console.log('ollama available:', available);

  const ai = new AiGameMasterService(client);
  const t0 = Date.now();
  const scenario = await ai.getScenario('haunted-village');
  console.log(`scenario (${Date.now() - t0}ms):`, JSON.stringify(scenario).slice(0, 300));

  const t1 = Date.now();
  const line = await ai.narrate('haunted-village', 'night', { seed: 1 });
  console.log(`narration (${Date.now() - t1}ms):`, line);

  if (!scenario.title || !scenario.intro || !line) {
    console.error('FAILED: missing content');
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
}
main().catch((e) => {
  console.error('CRASH', e);
  process.exit(1);
});
