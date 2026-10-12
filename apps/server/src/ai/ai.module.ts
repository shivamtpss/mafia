import { Global, Module } from '@nestjs/common';
import { OllamaClient } from './ollama.client';
import { AiGameMasterService } from './ai-game-master.service';

/**
 * AI module. Exposes the Ollama-backed game master globally so the game service
 * can enrich narration. All AI access is server-side only.
 */
@Global()
@Module({
  providers: [OllamaClient, AiGameMasterService],
  exports: [OllamaClient, AiGameMasterService],
})
export class AiModule {}
