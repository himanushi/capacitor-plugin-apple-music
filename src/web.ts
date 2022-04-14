/* eslint-disable @typescript-eslint/no-namespace */

import type { PluginListenerHandle } from '@capacitor/core';
import { WebPlugin, registerPlugin } from '@capacitor/core';
import { Howl } from 'howler';

export class CapacitorAppleMusicWeb
  extends WebPlugin
  implements CapacitorAppleMusicPlugin {
  private playbackStateDidChange = (state: {
    oldState: number;
    state: number;
  }) => {
    const status = MusicKit.PlaybackStates[state.state];
    const data = { result: status };
    this.notifyListeners('playbackStateDidChange', data);
  };

  private authorizationStatusDidChange = (result: {
    authorizationStatus: number;
  }) => {
    let status = '';
    if (result.authorizationStatus === -1) {
      status = 'unavailable';
    } else if (result.authorizationStatus === 0) {
      status = 'notDetermined';
    } else if (result.authorizationStatus === 1) {
      status = 'denied';
    } else if (result.authorizationStatus === 2) {
      status = 'restricted';
    } else if (result.authorizationStatus === 3) {
      status = 'authorized';
    }
    this.notifyListeners('authorizationStatusDidChange', { result: status });
  };

  async echo(options: { value: string }): Promise<{ value: string }> {
    console.log('ECHO', options);
    return options;
  }

  async configure(options: {
    config: MusicKit.Config;
  }): Promise<{ result: boolean }> {
    let configured = false;
    try {
      const musicKit = await MusicKit.configure(options.config);

      musicKit.addEventListener(
        'playbackStateDidChange',
        this.playbackStateDidChange,
      );

      musicKit.addEventListener(
        'authorizationStatusDidChange',
        this.authorizationStatusDidChange,
      );

      configured = true;
    } catch (error) {
      console.log(error);
    }
    return { result: configured };
  }

  async isAuthorized(): Promise<{ result: boolean }> {
    let authorized = false;
    try {
      authorized = Boolean(MusicKit.getInstance()?.isAuthorized);
    } catch (error) {
      console.log(error);
    }
    return { result: authorized };
  }

  async hasMusicSubscription(): Promise<{ result: boolean }> {
    let result = false;
    try {
      result = await MusicKit.getInstance().hasMusicSubscription();
    } catch (error) {
      console.log(error);
    }
    return { result };
  }

  async authorize(): Promise<{ result: boolean }> {
    try {
      await MusicKit.getInstance().authorize();
    } catch (error) {
      console.log(error);
    }
    return { result: true };
  }

  async unauthorize(): Promise<{ result: boolean }> {
    try {
      await MusicKit.getInstance().unauthorize();
    } catch (error) {
      console.log(error);
    }
    return { result: true };
  }

  player: Howl | undefined;
  defaultVolume = 1.0;
  fadeoutId: NodeJS.Timeout | undefined;

  resetFadeoutId(): void {
    if (this.fadeoutId !== undefined) {
      clearTimeout(this.fadeoutId);
      this.fadeoutId = undefined;
    }
  }

  async resetMusicKit(): Promise<void> {
    MusicKit.getInstance().volume = this.defaultVolume;
    await MusicKit.getInstance().stop();
    await MusicKit.getInstance().queue.reset();
  }

  async resetPreviewPlayer(): Promise<void> {
    this.resetFadeoutId();
    if (this.player) {
      this.player.stop();
      this.player.off('play');
      this.player.off('pause');
      this.player.off('end');
      this.player.off('stop');
      this.player = undefined;
    }
  }

  async reset(): Promise<void> {
    await this.resetMusicKit();
    this.resetPreviewPlayer();
  }

  async setSong(options: {
    songId: string;
    previewUrl?: string;
    songTitle?: string;
  }): Promise<{ result: boolean }> {
    const replaceName = (name: string) => {
      // 名前が長すぎる場合は検索で引っかからないのでなるべく短い名前にする
      return name.replace(/(?!^)(\[|\(|-|:|〜|~|,).*/g, '');
    };

    const getLibrarySongs = async (name: string) => {
      const endpoint = `/v1/me/library/search?term=${replaceName(
        name,
      )}&types=library-songs`;
      return await getLoopLibrarySongs(endpoint);
    };

    const getLoopLibrarySongs = async (endpoint: string) => {
      const results: MusicKit.APIResultData[] = [];
      const response = await searchLibrarySongs(`${endpoint}&limit=25`);

      if (!('results' in response.data)) return results;

      if (response.data.results['library-songs']?.data) {
        results.push(...response.data.results['library-songs'].data);
      }

      if (response.data.results['library-songs']?.next) {
        results.push(
          ...(await getLoopLibrarySongs(
            response.data.results['library-songs']?.next,
          )),
        );
      }

      return results;
    };

    const searchLibrarySongs = async (endpoint: string) => {
      return await MusicKit.getInstance().api.music(endpoint);
    };

    try {
      if (!(await this.isAuthorized()).result) {
        if (options.previewUrl) {
          this.resetPreviewPlayer();
          console.log('🎵 ------ unAuth preview ---------', options.previewUrl);
          this.setPlayer(options.previewUrl);
          return { result: true };
        } else {
          return { result: false };
        }
      }

      const catalogResult = await MusicKit.getInstance().api.music(
        `v1/catalog/jp/songs/${options.songId}`,
      );

      await this.reset();

      if (!('data' in catalogResult.data)) return { result: false };

      const track = catalogResult.data.data[0];
      if (!track) return { result: false };

      const playable = Boolean(track.attributes.playParams);
      if (playable) {
        console.log('🎵 ------ Apple Music ---------');
        await MusicKit.getInstance().setQueue({ songs: [options.songId] });
      } else {
        const tracks = await getLibrarySongs(
          options.songTitle ?? track.attributes.name,
        );
        const purchasedTrack = tracks.find(
          trk => trk.attributes.playParams?.purchasedId === options.songId,
        );
        const previewUrl = track.attributes.previews[0]?.url;

        if (purchasedTrack) {
          console.log('🎵 ------ iTunes ---------');
          await MusicKit.getInstance().setQueue({ songs: [purchasedTrack.id] });
        } else if (previewUrl) {
          console.log('🎵 ------ preview ---------', previewUrl);
          this.setPlayer(previewUrl);
        }
      }
    } catch (error) {
      try {
        // Apple ID が 404 の場合
        console.log(error);

        if (!options.songTitle) {
          return { result: false };
        }

        const tracks = await getLibrarySongs(options.songTitle);
        const purchasedTrack = tracks.find(
          trk => trk.attributes.playParams?.purchasedId === options.songId,
        );
        const previewUrl = options.previewUrl;

        if (purchasedTrack) {
          console.log('🎵 ------ iTunes ---------');
          await MusicKit.getInstance().setQueue({ songs: [purchasedTrack.id] });
        } else if (previewUrl) {
          console.log('🎵 ------ preview ---------', previewUrl);
          this.setPlayer(previewUrl);
        }
      } catch (error) {
        console.log(error);
        return { result: false };
      }
    }
    return { result: true };
  }

  setPlayer(previewUrl: string): void {
    this.player = new Howl({
      autoplay: false,
      html5: true,
      preload: false,
      src: previewUrl,
      volume: 0,
    });

    const fadeouttime = 2000;

    const fadeIn = () => {
      if (!this.player) return;

      if (this.player.volume() === 0) {
        this.player.fade(0, this.defaultVolume, fadeouttime);
      } else {
        this.player.volume(this.defaultVolume);
      }
    };

    const fadeOut = () => {
      if (!this.player || this.fadeoutId !== undefined) return;

      const seek = this.player.seek() as number;

      const time = (this.player.duration() - seek) as number;

      const ms = time * 1000;

      const timeout = ms - fadeouttime;

      this.fadeoutId = setTimeout(() => {
        if (!this.player) return;
        this.player.fade(this.defaultVolume, 0, fadeouttime);
      }, timeout);
    };

    this.player.on('play', () => {
      fadeIn();
      fadeOut();
      this.notifyListeners('playbackStateDidChange', { result: 'playing' });
    });
    this.player.on('pause', () => {
      this.resetFadeoutId();
      this.notifyListeners('playbackStateDidChange', { result: 'paused' });
    });
    this.player.on('end', () => {
      this.resetFadeoutId();
      this.notifyListeners('playbackStateDidChange', { result: 'completed' });
    });
    this.player.on('stop', () => {
      this.resetFadeoutId();
      this.notifyListeners('playbackStateDidChange', { result: 'stopped' });
    });
    this.player.on('seek', () => {
      this.resetFadeoutId();
      fadeOut();
    });
  }

  async play(): Promise<{ result: boolean }> {
    let result = false;
    try {
      if (this.player) {
        this.player.play();
      } else {
        await MusicKit.getInstance().play();
      }
      result = true;
    } catch (error) {
      console.log(error);
    }
    return { result };
  }

  async setVolume(options: { volume: number }): Promise<{ result: boolean }> {
    this.defaultVolume = options.volume;
    return { result: true };
  }

  async stop(): Promise<{ result: boolean }> {
    let result = false;
    try {
      if (this.player) {
        this.player.stop();
      } else {
        await MusicKit.getInstance().stop();
      }
      result = true;
    } catch (error) {
      console.log(error);
    }
    return { result };
  }

  async pause(): Promise<{ result: boolean }> {
    let result = false;
    try {
      if (this.player) {
        this.player.pause();
      } else {
        await MusicKit.getInstance().pause();
      }
      result = true;
    } catch (error) {
      console.log(error);
    }
    return { result };
  }

  async currentPlaybackDuration(): Promise<{ result: number }> {
    let duration = 0;
    if (this.player) {
      duration = this.player.duration();
    } else {
      duration = await MusicKit.getInstance().currentPlaybackDuration;
    }
    return { result: duration };
  }

  async currentPlaybackTime(): Promise<{ result: number }> {
    let playbackTime = 0;
    if (this.player) {
      playbackTime = this.player.seek();
    } else {
      playbackTime = MusicKit.getInstance().currentPlaybackTime;
    }
    return { result: playbackTime };
  }

  async seekToTime(options: {
    playbackTime: number;
  }): Promise<{ result: boolean }> {
    let result = false;
    try {
      if (this.player) {
        this.player.seek(options.playbackTime);
      } else {
        MusicKit.getInstance().seekToTime(options.playbackTime);
      }
      result = true;
    } catch (error) {
      console.log(error);
    }
    return { result };
  }
}

const CapacitorAppleMusic = registerPlugin<CapacitorAppleMusicPlugin>(
  'CapacitorAppleMusic',
  {
    web: () => import('./web').then(m => new m.CapacitorAppleMusicWeb()),
  },
);

export { CapacitorAppleMusic };

export type PlaybackStates = keyof typeof MusicKit.PlaybackStates;
export type PlaybackStateDidChangeListener = (state: {
  result: PlaybackStates;
}) => void;

export type AuthorizationStatus =
  | 'unavailable'
  | 'notDetermined'
  | 'denied'
  | 'restricted'
  | 'authorized';
export type AuthorizationStatusDidChangeListener = (state: {
  result: AuthorizationStatus;
}) => void;

interface CapacitorAppleMusicPlugin {
  echo(options: { value: string }): Promise<{ value: string }>;
  configure(options: { config: MusicKit.Config }): Promise<{ result: boolean }>;
  isAuthorized(): Promise<{ result: boolean }>;
  hasMusicSubscription(): Promise<{ result: boolean }>;
  authorize(): Promise<{ result: boolean }>;
  unauthorize(): Promise<{ result: boolean }>;
  setSong(options: {
    songId: string;
    previewUrl?: string;
    songTitle?: string;
  }): Promise<{ result: boolean }>;
  play(): Promise<{ result: boolean }>;
  stop(): Promise<{ result: boolean }>;
  pause(): Promise<{ result: boolean }>;
  currentPlaybackDuration(): Promise<{ result: number }>;
  currentPlaybackTime(): Promise<{ result: number }>;
  seekToTime(options: { playbackTime: number }): Promise<{ result: boolean }>;
  setVolume(options: { volume: number }): Promise<{ result: boolean }>;
  addListener(
    eventName: 'playbackStateDidChange',
    listenerFunc: PlaybackStateDidChangeListener,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
  addListener(
    eventName: 'authorizationStatusDidChange',
    listenerFunc: AuthorizationStatusDidChangeListener,
  ): Promise<PluginListenerHandle> & PluginListenerHandle;
}

// ver: 3.2136.9-prerelease
declare namespace MusicKit {
  interface Config {
    developerToken: string;
    app: {
      name: string;
      build: string;
    };
  }
  function configure(config: Config): Promise<MusicKitInstance>;
  function getInstance(): MusicKitInstance;

  interface MusicKitInstance {
    api: AppleMusicAPI;
    queue: Queue;
    storefrontId: string;
    volume: number;
    readonly currentPlaybackTime: number;
    readonly currentPlaybackDuration: number;
    readonly isAuthorized: boolean;
    authorize: () => void;
    unauthorize: () => void;
    setQueue: (options: { songs: string[] }) => Promise<void>;
    play: () => Promise<void>;
    stop: () => Promise<void>;
    pause: () => Promise<void>;
    seekToTime: (playbackTime: number) => Promise<void>;
    addEventListener: (eventName: string, callback: any) => number;
    hasMusicSubscription: () => boolean;
  }

  interface AppleMusicAPI {
    music(
      endpoint: string,
      params?: Record<string, any>,
    ): Promise<APIResultCatalogSongs | APIResultLibrarySongs>;
  }

  interface APIResultCatalogSongs {
    data: {
      data: CatalogSong[];
    };
  }

  interface CatalogSong {
    attributes: CatalogSongAttributes;
  }

  interface CatalogSongAttributes {
    name: string;
    playParams?: {
      id: string;
    };
    previews: CatalogSongPreview[];
  }

  interface CatalogSongPreview {
    url: string;
  }

  interface APIResultLibrarySongs {
    data: {
      results: {
        'library-songs'?: {
          data: APIResultData[];
          next?: string;
          href: string;
        };
      };
    };
  }

  interface APIResultData {
    id: string;
    type: string;
    href: string;
    attributes: {
      name: string;
      playParams: {
        purchasedId?: string;
      };
    };
  }

  interface Queue {
    reset: () => void;
  }

  enum PlaybackStates {
    none,
    loading,
    playing,
    paused,
    stopped,
    ended,
    seeking,
    waiting,
    stalled,
    completed,
  }
}
