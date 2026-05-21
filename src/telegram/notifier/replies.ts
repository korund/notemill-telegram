const ERROR_MSG_MAX = 200;

export function formatNoSpeechReply(reason: 'silent'): string {
  switch (reason) {
    case 'silent':
      return 'Не услышал речи в записи.';
  }
}

export function formatErrorReply(code: string, rawMsg: string): string {
  const oneLine = rawMsg.replace(/\s+/g, ' ').trim();
  const truncated =
    oneLine.length > ERROR_MSG_MAX ? `${oneLine.slice(0, ERROR_MSG_MAX)}...` : oneLine;
  return `${code}: ${truncated}`;
}
