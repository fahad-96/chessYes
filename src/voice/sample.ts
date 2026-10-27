import { scriptFromKeys, type CoachScript } from './coachScript';
import { PHRASES, freeKey, verdictKeys } from './vocabulary';

/**
 * The line "Test voice" plays: "Rook to g8. That's a blunder. Bishop takes g8, winning the
 * rook for free. Rook takes g7 was better."
 */
export function coachSampleLine(): CoachScript {
  return scriptFromKeys([
    'move:Rg8',
    verdictKeys('blunder')[0]!,
    'move:Bxg8',
    freeKey('tail', 'r'),
    'move:Rxg7',
    PHRASES.wasBetter,
  ]);
}
