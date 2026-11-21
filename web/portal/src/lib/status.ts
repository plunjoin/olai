export interface StatusState {
  ready: boolean;
  imageMode: string;
  audioMode: string;
  videoMode: 'chat' | 'task';
  shortFilm: boolean;
  githubLogin: boolean;
  googleLogin: boolean;
  mediaStorage: 'oss' | 'local';
}

let cached: StatusState | null = null;
let inflight: Promise<StatusState> | null = null;

export const DEFAULT_STATUS: StatusState = {
  ready: false,
  imageMode: 'auto',
  audioMode: 'auto',
  videoMode: 'chat',
  shortFilm: false,
  githubLogin: false,
  googleLogin: false,
  mediaStorage: 'local',
};

export function loadStatus(): Promise<StatusState> {
  if (cached) return Promise.resolve(cached);
  if (!inflight) {
    inflight = fetch('/api/status', { credentials: 'same-origin' })
      .then(async response => {
        if (!response.ok) throw new Error('status');
        const body = await response.json();
        cached = {
          ready: body.ready === true,
          imageMode: typeof body.imageMode === 'string' && body.imageMode ? body.imageMode : 'auto',
          audioMode: typeof body.audioMode === 'string' && body.audioMode ? body.audioMode : 'auto',
          videoMode: body.videoMode === 'task' ? 'task' : 'chat',
          shortFilm: body.shortFilm === true,
          githubLogin: body.githubLogin === true,
          googleLogin: body.googleLogin === true,
          mediaStorage: body.mediaStorage === 'oss' ? 'oss' : 'local',
        };
        return cached;
      })
      .catch(() => cached = { ...DEFAULT_STATUS })
      .finally(() => { inflight = null; });
  }
  return inflight;
}

export function invalidateStatus() { cached = null; }
