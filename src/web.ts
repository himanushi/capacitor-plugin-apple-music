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
    librarySongId?: string;
    previewUrl?: string;
    songTitle?: string;
    albumTitle?: string;
    forcePreview?: boolean;
  }): Promise<{
    result: boolean;
    librarySongId?: string;
    albumTitle?: string;
  }> {
    const replaceName = (name: string) => {
      // 名前が長すぎる場合は検索で引っかからないのでなるべく短い名前にする
      return name.replace(/(?!^)(\[|\(|-|:|〜|~|,).*/g, '');
    };

    const getLibrarySong = async (name: string, songId: string) => {
      const endpoint = `/v1/me/library/search?term=${replaceName(
        name,
      )}&types=library-songs`;
      return await getLoopLibrarySong(endpoint, songId);
    };

    const getLoopLibrarySong = async (
      endpoint: string,
      songId: string,
    ): Promise<MusicKit.APIResultData | null> => {
      const response = await searchLibrarySongs(`${endpoint}&limit=25`);

      if (!('results' in response.data)) return null;

      const track = response.data.results['library-songs']?.data.find(
        trk => trk.attributes.playParams?.purchasedId === options.songId,
      );

      if (track) {
        return track;
      }

      if (response.data.results['library-songs']?.next) {
        return await getLoopLibrarySong(
          response.data.results['library-songs']?.next,
          songId,
        );
      }

      return null;
    };

    const searchLibrarySongs = async (endpoint: string) => {
      return await MusicKit.getInstance().api.music(endpoint);
    };

    try {
      await this.reset();

      // ライブラリ参照権限がない場合はプレビュー再生
      // または
      // 強制的にプレビュー再生
      if (!(await this.isAuthorized()).result || options.forcePreview) {
        if (options.previewUrl) {
          this.resetPreviewPlayer();
          if (options.forcePreview) {
            console.log(
              '🎵 ------ force preview ---------',
              options.previewUrl,
            );
          } else {
            console.log(
              '🎵 ------ unAuth preview ---------',
              options.previewUrl,
            );
          }
          this.setPlayer(options.previewUrl);
          return { result: true };
        } else {
          return { result: false };
        }
      }

      // ライブラリIDが存在する場合はライブラリの曲を再生
      if (options.librarySongId) {
        console.log('🎵 ------ iTunes Cache ---------');
        await MusicKit.getInstance().setQueue({
          songs: [options.librarySongId],
        });
        return { result: true, librarySongId: options.librarySongId };
      }

      const catalogResult = await MusicKit.getInstance().api.music(
        `v1/catalog/jp/songs/${options.songId}`,
      );

      if (!('data' in catalogResult.data)) return { result: false };

      const track = catalogResult.data.data[0];
      if (!track) return { result: false };

      const playable = Boolean(track.attributes.playParams);
      if (playable) {
        console.log('🎵 ------ Apple Music ---------');
        await MusicKit.getInstance().setQueue({ songs: [options.songId] });
      } else {
        const purchasedTrack = await getLibrarySong(
          options.songTitle ?? track.attributes.name,
          options.songId,
        );
        const previewUrl = track.attributes.previews[0]?.url;

        if (purchasedTrack) {
          console.log('🎵 ------ iTunes ---------');
          await MusicKit.getInstance().setQueue({ songs: [purchasedTrack.id] });
          return {
            result: true,
            librarySongId: purchasedTrack.id,
            albumTitle: purchasedTrack.attributes.albumName,
          };
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

        const purchasedTrack = await getLibrarySong(
          options.songTitle,
          options.songId,
        );
        const previewUrl = options.previewUrl;

        if (purchasedTrack) {
          console.log('🎵 ------ iTunes ---------');
          await MusicKit.getInstance().setQueue({ songs: [purchasedTrack.id] });
          return {
            result: true,
            librarySongId: purchasedTrack.id,
            albumTitle: purchasedTrack.attributes.albumName,
          };
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

  async getLibraryAlbum(options: {
    id?: string;
    title?: string;
  }): Promise<{
    result: boolean;
    album?: {
      title: string;
      id: string;
      tracks: {
        title: string;
        id: string;
        discNumber: string;
        trackNumber: string;
      }[];
    };
  }> {
    let result = false;
    let album:
      | {
          title: string;
          id: string;
          tracks: {
            title: string;
            id: string;
            discNumber: string;
            trackNumber: string;
          }[];
        }
      | undefined = undefined;

    const replaceName = (name: string) =>
      name
        .replace(/(?!^)(\[|\(|-|:|〜|~|,).*/gu, ' ')
        .split(' ')
        .slice(0, 1)
        .join(' ');

    let hasNext = false;
    let resultAlbum: MusicKit.APIResultData | undefined;
    let fetchUrl = '';

    if (options.title) {
      fetchUrl = `/v1/me/library/search?types=library-albums&limit=25&term=${replaceName(
        options.title,
      )}`;
    } else if (options.id) {
      fetchUrl = `/v1/me/library/albums/${options.id}`;
    } else {
      return { result: false };
    }

    // アルバム検索
    const limit = 10;
    let count = 0;
    do {
      // 無限ループの可能性を排除
      count += 1;
      if (count > limit) {
        break;
      }
      hasNext = false;
      const response = await MusicKit.getInstance().api.music(fetchUrl);
      const albums = options.id
        ? { data: response.data.data, next: false }
        : response.data.results['library-albums'];

      if (albums) {
        resultAlbum = albums.data.find(
          abm => abm.attributes.name === options.title,
        );
        if (resultAlbum) {
          album = {
            title: resultAlbum.attributes.name,
            id: resultAlbum.id,
            tracks: [],
          };
          break;
        }
        if (albums.next) {
          hasNext = true;
          fetchUrl = `${albums.next}&limit=25`;
        }
      }
    } while (hasNext);

    // 購入
    if (album) {
      // 曲一覧
      hasNext = false;
      fetchUrl = `/v1/me/library/albums/${album.id}/tracks?limit=100`;
      const tracks: {
        title: string;
        id: string;
        discNumber: string;
        trackNumber: string;
      }[] = [];
      count = 0;

      do {
        // 無限ループの可能性を排除
        count += 1;
        if (count > limit) {
          break;
        }
        hasNext = false;
        const response = await MusicKit.getInstance().api.music(fetchUrl);
        const data = response.data;
        if (data) {
          for (const track of data.data) {
            if (track.attributes.playParams.purchasedId) {
              tracks.push({
                title: track.attributes.name,
                id: track.id,
                discNumber: track.attributes.discNumber.toString(),
                trackNumber: track.attributes.trackNumber.toString(),
              });
            }
          }
          if (data.next) {
            hasNext = true;
            fetchUrl = `${data.next}&limit=100`;
          }
        }
      } while (hasNext);

      album.tracks = tracks;
      result = true;
    }

    return { result, album };
  }

  async getLibraryAlbums(options: {
    limit: number;
    offset: number;
  }): Promise<{
    result: boolean;
    albums: {
      title: string;
      id: string;
      artworkUrl?: string;
    }[];
    hasNext: boolean;
  }> {
    const albums: {
      title: string;
      id: string;
      artworkUrl?: string;
    }[] = [];

    const response = await MusicKit.getInstance().api.music(
      `/v1/me/library/albums?limit=${options.limit}&offset=${options.offset}`,
    );

    response.data.data.map(album => {
      albums.push({
        title: album.attributes.name,
        id: album.id,
        artworkUrl: album.attributes.artwork?.url,
      });
    });

    const hasNext =
      response.data.meta.total !== options.offset + response.data.data.length;

    return { result: true, albums, hasNext };
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
    librarySongId?: string;
    previewUrl?: string;
    songTitle?: string;
    albumTitle?: string;
    forcePreview?: boolean;
  }): Promise<{
    result: boolean;
    librarySongId?: string;
    albumTitle?: string;
  }>;
  getLibraryAlbum(options: {
    id?: string;
    title?: string;
  }): Promise<{
    result: boolean;
    album?: {
      title: string;
      id: string;
      tracks: {
        title: string;
        id: string;
        discNumber: string;
        trackNumber: string;
      }[];
    };
  }>;
  getLibraryAlbums(options: {
    limit: number;
    offset: number;
  }): Promise<{
    result: boolean;
    albums: {
      title: string;
      id: string;
      artworkUrl?: string;
    }[];
    hasNext: boolean;
  }>;
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

  function configure(config: Config): MusicKitInstance;
  function getInstance(): MusicKitInstance;
  function formatMediaTime(seconds: number, separator?: string): string;

  interface MusicKitInstance {
    api: API;
    bitrate: number;
    developerToken: string;
    isAuthorized: boolean;
    isRestricted: boolean;
    medianDownlink: number;
    musicUserToken: string;
    playbackState: number;
    playbackTargetAvailable?: any;
    player: SerialPlayback;
    previewOnly: boolean;
    privateEnabled: boolean;
    siriInitiated: boolean;
    storefrontId: string;
    readonly storefrontCountryCode: string;
    storekit: StoreKit;
    subscribeFamilyURL: string;
    subscribeIndividualURL: string;
    subscribeStudentURL: string;
    subscribeURL: string;
    version: string;
    volume: number;
    currentPlaybackTime: number;
    currentBufferedProgress: number;
    currentPlaybackDuration: number;
    isPlaying: boolean;
    queue: Queue;

    addEventListener(eventName: string, callback: (result: any) => any): void;
    removeEventListener(
      eventName: string,
      callback: (result: any) => any,
    ): void;
    addToLibrary(e: any, t?: any): Promise<any>;
    authorize(): Promise<string>;
    changeToMediaAtIndex(e: any): Promise<any>;
    cleanup(): Promise<any>;
    clearQueue(): Promise<any>;
    deferPlayback(): Promise<any>;
    me(): Promise<any>;
    pause(): Promise<any>;
    play(): Promise<any>;
    playLater(e: any): Promise<any>;
    playNext(e: any, t: any): Promise<any>;
    seekBackward(): Promise<any>;
    seekForward(): Promise<any>;
    seekToTime(e: any): Promise<any>;
    setQueue(e: any): Promise<any>;
    skipToNextItem(): Promise<any>;
    skipToPreviousItem(): Promise<any>;
    stop(): Promise<any>;
    unauthorize(): Promise<any>;
    hasMusicSubscription(): Promise<any>;
  }

  interface StoreKit {
    apiBase: string;
    authorizationStatus: number;
    cid?: any;
    developerToken: string;
    eligibleForSubscribeView: boolean;
    hasAuthorized: boolean;
    persist: string;
    playBase: string;
    prefix: string;
    restrictedEnabled: boolean;
    storage: any;
    storagePrefix: string;
    storefrontCountryCode: string;
    storefrontIdentifier: string;
    userToken: string;
    userTokenIsValid: boolean;
  }

  interface API {
    music(endpoint: string, params?: Record<string, any>): Promise<APIResult>;
    developerToken: string;
    enablePlayEquivalencies: boolean;
    headers: any;
    library: any;
    method: string;
    prefix: string;
    storage: any;
    ttl: number;
    url: string;
    userToken: string;
    needsEquivalents: boolean;
    storefrontId: string;

    song(appleId: string): Promise<Song>;
    songs(appleIds: string[]): Promise<Song[]>;
  }

  interface APIResult {
    data: {
      results: {
        'library-songs'?: {
          data: APIResultData[];
          href: string;
          next: string;
        };
        'library-albums'?: {
          data: APIResultData[];
          href: string;
          next: string;
        };
      };
      data: APIResultData[];
      meta: { total: number };
      next: string;
    };
  }

  interface APIResultData {
    id: string;
    type: string;
    href: string;
    attributes: {
      discNumber: number;
      trackNumber: number;
      name: string;
      durationInMillis: number;
      artwork?: { url: string };
      albumName: string;
      playParams: {
        id: string;
        purchasedId?: string;
        isLibrary: boolean;
        kind: 'album' | 'song';
      };
      previews: { url: string }[];
    };
    relationships: {
      tracks: {
        data: APIResultData[];
        meta: { total: number };
        href: string;
        next: string;
      };
      type: 'library-albums';
    };
  }

  interface BaseProperty {
    type: string;
    id: string;
    href: string;
  }

  interface Relationship {
    data: BaseProperty[];
    href: string;
  }

  interface Song extends BaseProperty {
    attributes: SongAttributes;
    relationships: {
      albums: Relationship[];
      artists: Relationship[];
    };
  }

  interface SongAttributes {
    albumName: string;
    artistName: string;
    artwork: ArtWork;
    composerName: string;
    discNumber: number;
    durationInMillis: number;
    genreNames: string[];
    hasLyrics: boolean;
    isrc: string;
    name: string;
    playParams: {
      id: string;
      kind: string;
    };
    previews: {
      url: string;
    }[];
    releaseDate: string;
    trackNumber: number;
    url: string;
  }

  interface ArtWork {
    bgColor: string;
    height: number;
    textColor1: string;
    textColor2: string;
    textColor3: string;
    textColor4: string;
    url: string;
    width: number;
  }

  interface SerialPlayback {
    _registry: { playbackStateDidChange: any[] };
    bitrate: number;
    canSupportDRM: boolean;
    continuous: boolean;
    currentPlaybackDuration: number;
    currentPlaybackProgress: number;
    currentPlaybackTime: number;
    currentPlaybackTimeRemaining: any | number;
    hasAuthorization: boolean;
    isPlaying: boolean;
    isPrimaryPlayer: boolean;
    isReady: boolean;
    nowPlayingItem: MediaItem;
    nowPlayingItemIndex: number;
    playbackRate: number;
    playbackState: number;
    queue: Queue;
    repeatMode: 0 | 1 | 2;
    shuffleMode: number;
    formattedCurrentPlaybackDuration: {
      hours: any | number;
      minutes: any | number;
    };

    addEventListener(
      eventName: string,
      callback: (state: { oldState: number; state: number }) => any,
    ): void;
    removeEventListener(
      eventName: string,
      callback: (state: { oldState: number; state: number }) => any,
    ): void;
    changeToMediaAtIndex(index: number): Promise<any>;
    changeToMediaItem(): Promise<any>;
    destroy(): Promise<any>;
    mute(): Promise<any>;
    pause(): Promise<any>;
    play(): Promise<any>;
    preload(): Promise<any>;
    prepareToPlay(e: any, t: any, r: any): Promise<any>;
    seekBackward(): Promise<any>;
    seekForward(): Promise<any>;
    seekToTime(e: any): Promise<any>;
    showPlaybackTargetPicker(): Promise<any>;
    skipToNextItem(): Promise<any>;
    skipToPreviousItem(): Promise<any>;
    stop(): Promise<any>;
  }

  interface Queue {
    isEmpty: boolean;
    isRestricted: boolean;
    items: MediaItem[];
    length: number;
    nextPlayableItem?: MediaItem;
    nextPlayableItemIndex?: number;
    position: number;
    previousPlayableItem?: MediaItem;
    previousPlayableItemIndex?: number;

    addEventListener(eventName: string, callback: (result: any) => any): void;
    removeEventListener(
      eventName: string,
      callback: (result: any) => any,
    ): void;
    append(song: Song): void;
    indexForItem(e: any): Promise<any>;
    item(e: any): Promise<any>;
    prepend(e: any, t: any): Promise<any>;
    remove(index?: number): Promise<any>;
    requiresPlayActivity(): Promise<any>;
    shuffle(e: any): Promise<any>;
    unshuffle(e: any): Promise<any>;
    reset(): Promise<any>;
  }

  interface MediaItem {
    albumInfo: string;
    albumName: string;
    artistName: string;
    artwork: ArtWork;
    artworkURL: string;
    assets: any[];
    attributes: SongAttributes;
    canPlay: boolean;
    container: {
      id: string;
      name: string;
    };
    contentRating?: number;
    discNumber: number;
    equivalent?: any;
    hasContainerArtwork?: any;
    hasPlaylistContainer: boolean;
    id: string;
    info: string;
    isCloudItem: boolean;
    isCloudUpload: boolean;
    isExplicitItem: boolean;
    isLoading: boolean;
    isPlayable: {
      id: string;
      kind: string;
    };
    isPlaying: boolean;
    isPreparedToPlay: boolean;
    isReady: boolean;
    isRestricted: boolean;
    isUnavailable: boolean;
    isrc: string;
    playParams: {
      id: string;
      kind: string;
    };
    playRawAssetURL: boolean;
    playbackDuration: number;
    playlistArtworkURL: string;
    playlistName: string;
    previewURL: string;
    relationships: {
      albums: Relationship[];
      artists: Relationship[];
    };
    releaseDate: Date;
    songId: string;
    state: number;
    title: string;
    trackNumber: number;
    type: string;
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

  const Events: {
    authorizationStatusDidChange: string;
    authorizationStatusWillChange: string;
    bufferedProgressDidChange: string;
    configured: string;
    eligibleForSubscribeView: string;
    loaded: string;
    mediaCanPlay: string;
    mediaItemDidChange: string;
    mediaItemStateDidChange: string;
    mediaItemStateWillChange: string;
    mediaItemWillChange: string;
    mediaPlaybackError: string;
    mediaPlaybackPreview: string;
    metadataDidChange: string;
    playbackBitrateDidChange: string;
    playbackDurationDidChange: string;
    playbackProgressDidChange: string;
    playbackStateDidChange: string;
    playbackStateWillChange: string;
    playbackTargetAvailableDidChange: string;
    playbackTimeDidChange: string;
    playbackVolumeDidChange: string;
    primaryPlayerDidChange: string;
    queueItemForStartPosition: string;
    queueItemsDidChange: string;
    queuePositionDidChange: string;
    storefrontCountryCodeDidChange: string;
    storefrontIdentifierDidChange: string;
    userTokenDidChange: string;
  };
}
