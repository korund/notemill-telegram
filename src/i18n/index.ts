import enMessages from './en.json' with { type: 'json' };
import ruMessages from './ru.json' with { type: 'json' };

export type Messages = typeof enMessages;

const locales: Record<string, Messages> = {
  en: enMessages,
  ru: ruMessages,
};

// BCP-47: take the primary language subtag before '-' (e.g. 'en-US' -> 'en').
// Unknown prefixes fall back to English.
export function pickMessages(languageCode: string | undefined): Messages {
  if (languageCode === undefined) return enMessages;
  const prefix = languageCode.split('-')[0] ?? '';
  return locales[prefix] ?? enMessages;
}
