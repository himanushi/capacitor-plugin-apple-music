import Foundation
import Capacitor
import MediaPlayer
import MusicKit

/**
 * Please read the Capacitor iOS Plugin Development Guide
 * here: https://capacitorjs.com/docs/plugins/ios
 */
let resultKey = "result"

@available(iOS 15.0, *)
@objc(CapacitorAppleMusicPlugin)
public class CapacitorAppleMusicPlugin: CAPPlugin {
    let player = MPMusicPlayerController.applicationMusicPlayer
    var previewPlayer: AVPlayer?

    override public func load() {
        let audioSession = AVAudioSession.sharedInstance()
        do {
            // AVPlayer をサイレントモードとバックグラウンドで再生する
            // TODO: interruptSpokenAudioAndMixWithOthers を設定すると AVPlayer による MPRemoteCommandCenter が有効にならないのでどうにかすること
            try audioSession.setCategory(.playback, mode: .default, options: [.interruptSpokenAudioAndMixWithOthers])
            try audioSession.setActive(true)
        } catch {
            print(error)
        }

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.playbackStateDidChange),
            name: .MPMusicPlayerControllerPlaybackStateDidChange,
            object: nil)

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(self.authorizationStatusDidChange),
            name: UIApplication.didBecomeActiveNotification,
            object: nil
        )
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    var prevPlaybackState: MPMusicPlaybackState = .stopped
    var started = false
    @objc private func playbackStateDidChange() {
        var result = ""

        let currentDuration = MPMusicPlayerController.applicationMusicPlayer.nowPlayingItem?.playbackDuration ?? 0.0

        // 曲が終わる3秒前に一時停止をした場合は曲が再生終了したとみなす
        if started &&
           player.playbackState == .paused &&
           prevPlaybackState == .playing &&
           player.currentPlaybackTime + 3 >= currentDuration
        {
            result = "completed"
            prevPlaybackState = .stopped
            started = false
        }
        else if player.playbackState == .playing &&
                prevPlaybackState != .playing
        {
            result = "playing"
            started = true
        }
        else if player.playbackState == .paused &&
                prevPlaybackState != .paused
        {
            result = "paused"
        }
        else if player.playbackState == .stopped &&
                prevPlaybackState != .stopped
        {
            result = "stopped"
        }
        else if player.playbackState == .interrupted &&
                prevPlaybackState != .interrupted
        {
            result = "paused"
        }

        prevPlaybackState = player.playbackState

        if result != "" {
            notifyListeners("playbackStateDidChange", data: ["result": result])
        }
    }

    @objc private func authorizationStatusDidChange() {
        Task {
            let status = MusicAuthorization.currentStatus
            if status == .notDetermined {
                notifyListeners("authorizationStatusDidChange", data: ["result": "notDetermined"])
            } else if status == .denied {
                notifyListeners("authorizationStatusDidChange", data: ["result": "denied"])
            } else if status == .restricted {
                notifyListeners("authorizationStatusDidChange", data: ["result": "restricted"])
            } else if status == .authorized {
                notifyListeners("authorizationStatusDidChange", data: ["result": "authorized"])
            }
        }
    }

    @objc func echo(_ call: CAPPluginCall) {
        let value = call.getString("value") ?? ""
        call.resolve(["value": value])
    }

    @objc func configure(_ call: CAPPluginCall) {
        call.resolve([resultKey: true])
    }

    @objc func setVolume(_ call: CAPPluginCall) {
        call.resolve([resultKey: true])
    }

    @objc func isAuthorized(_ call: CAPPluginCall) {
        var result = false
        if MusicAuthorization.currentStatus == .authorized {
            result = true
        }
        call.resolve([resultKey: result])
    }

    @objc func authorize(_ call: CAPPluginCall) {
        Task {
            var result = false
            let status = await MusicAuthorization.request()
            if status == .authorized {
                result = true
            } else {
                guard let settingsURL = await URL(string: UIApplication.openSettingsURLString ) else {
                    call.resolve([resultKey: result])
                    return
                }
                await UIApplication.shared.open(settingsURL, options: [:], completionHandler: nil)
            }
            call.resolve([resultKey: result])
        }
    }

    @objc func unauthorize(_ call: CAPPluginCall) {
        Task {
            // 設定アプリに遷移するだけなので authorizationStatusDidChange は発火させない
            guard let settingsURL = await URL(string: UIApplication.openSettingsURLString ) else {
                call.resolve([resultKey: false])
                return
            }
            await UIApplication.shared.open(settingsURL, options: [:], completionHandler: nil)
            call.resolve([resultKey: true])
        }
    }

    @objc func play(_ call: CAPPluginCall) {
        Task {
            var result = false
            do {
                if (previewPlayer?.currentItem) != nil {
                    await previewPlayer?.play()
                } else if(playable) {
                    try await ApplicationMusicPlayer.shared.play()
                } else {
                    player.play()
                }
                result = true
            } catch {
                print(error)
            }
            call.resolve([resultKey: result])
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        Task {
            if (previewPlayer?.currentItem) != nil {
                await previewPlayer?.pause()
            } else {
                ApplicationMusicPlayer.shared.stop()
            }
            call.resolve([resultKey: true])
        }
    }

    @objc func pause(_ call: CAPPluginCall) {
        Task {
            if (previewPlayer?.currentItem) != nil {
                await previewPlayer?.pause()
            } else {
                ApplicationMusicPlayer.shared.pause()
            }
            call.resolve([resultKey: true])
        }
    }

    @objc func currentPlaybackDuration(_ call: CAPPluginCall) {
        Task {
            var duration = 0.0
            if let currentItem = previewPlayer?.currentItem {
                duration = currentItem.asset.duration.seconds
            } else if let playbackDuration = MPMusicPlayerController.applicationMusicPlayer.nowPlayingItem?.playbackDuration {
                duration = playbackDuration
            }
            call.resolve([resultKey: duration])
        }
    }

    @objc func currentPlaybackTime(_ call: CAPPluginCall) {
        Task {
            var playbackTime = 0.0
            if let currentTime = previewPlayer?.currentTime() {
                playbackTime = Double(CMTimeGetSeconds(currentTime))
            } else {
                playbackTime = ApplicationMusicPlayer.shared.playbackTime
            }
            call.resolve([resultKey: playbackTime])
        }
    }

    @objc func seekToTime(_ call: CAPPluginCall) {
        let playbackTime = call.getDouble("playbackTime") ?? 0.0
        Task {
            if let prePlayer = previewPlayer {
                await prePlayer.seek(to: CMTimeMakeWithSeconds(playbackTime, preferredTimescale: Int32(NSEC_PER_SEC)))
            } else {
                ApplicationMusicPlayer.shared.playbackTime = playbackTime
            }
            call.resolve([resultKey: true])
        }
    }

    var playable = false
    @objc func setSong(_ call: CAPPluginCall) {
        let songId = call.getString("songId") ?? ""
        let previewUrl = call.getString("previewUrl") ?? ""
        let songTitle = call.getString("songTitle")
        Task {
            var result = false

            do {

                if MusicAuthorization.currentStatus == .authorized {

                    await reset()

                    let request = MusicCatalogResourceRequest<MusicKit.Song>(matching: \.id, equalTo: MusicItemID(songId))
                    let response = try await request.response()

                    if let track = response.items.first {

                        playable = track.playParameters != nil

                        if(playable) {
                            print("🎵 ------ Apple Music ---------")
                            // Apple Music
                            ApplicationMusicPlayer.shared.queue = [track]
                            result = true
                        } else {
                            let term = (songTitle ?? track.title)
                                            .replacingOccurrences(of: "[", with: " ")
                                            .replacingOccurrences(of: "]", with: " ")
                                            .replacingOccurrences(of: "(", with: " ")
                                            .replacingOccurrences(of: ")", with: " ")
                                            .replacingOccurrences(of: "-", with: " ")
                                            .replacingOccurrences(of: ".", with: " ")
                                            .replacingOccurrences(of: ",", with: " ")
                                            .addingPercentEncoding(withAllowedCharacters: .urlPathAllowed)
                            let urlString = "https://api.music.apple.com/v1/me/library/search?term=\(term!)&types=library-songs&limit=25"

                            if let url = URL(string: urlString) {

                                let data = try await MusicDataRequest(urlRequest: URLRequest(url: url)).response()
                                let response: LibrarySongsResults = try JSONDecoder().decode(LibrarySongsResults.self, from: data.data)

                                if let purchasedTrack = response.results?.librarySongs?.data?.filter({ song in
                                    return song.attributes?.playParams?.purchasedID == songId
                                }).first {
                                    let query = MPMediaQuery.songs()
                                    let trackTitleFilter = MPMediaPropertyPredicate(
                                        value: purchasedTrack.attributes?.name,
                                        forProperty: MPMediaItemPropertyTitle,
                                        comparisonType: .equalTo)
                                    let albumTitleFilter = MPMediaPropertyPredicate(
                                        value: purchasedTrack.attributes?.albumName,
                                        forProperty: MPMediaItemPropertyAlbumTitle,
                                        comparisonType: .equalTo)
                                    let filterPredicates: Set<MPMediaPredicate> = [trackTitleFilter, albumTitleFilter]
                                    query.filterPredicates = filterPredicates
                                    if (query.items?.count ?? 0) > 0 {
                                        print("🎵 ------ iTunes ---------")
                                        player.setQueue(with: query)
                                        result = true
                                    } else if let trackPreviewUrl = track.previewAssets?.first?.url {
                                        // 購入したけどまだ反映されていない場合。大体数時間~数日反映に時間がかかる。
                                        print("🎵 ------ preview ---------", trackPreviewUrl)
                                        setPlayer(trackPreviewUrl)
                                        result = true
                                    }
                                } else if let trackPreviewUrl = track.previewAssets?.first?.url {
                                    print("🎵 ------ preview ---------", trackPreviewUrl)
                                    // Play the preview
                                    setPlayer(trackPreviewUrl)
                                    result = true
                                }
                            }
                        }
                    }
                } else if let trackPreviewUrl = URL(string: previewUrl) {
                    await resetPreviewPlayer()
                    print("🎵 ------ unAuth preview ---------", trackPreviewUrl)
                    // Play the preview
                    setPlayer(trackPreviewUrl)
                    result = true
                }
            } catch {
                print(error)
            }

            call.resolve([resultKey: result])
        }

    }

    private func setPlayer(_ previewUrl: URL) -> Void {
        let playerItem = AVPlayerItem(url: previewUrl)
        previewPlayer = AVPlayer(playerItem: playerItem)
        previewPlayer!.addObserver(self, forKeyPath: "rate", options: [], context: nil)
    }

    private func resetMusicKit() async -> Void {
        ApplicationMusicPlayer.shared.stop()
        ApplicationMusicPlayer.shared.queue = []
        player.stop()
        player.setQueue(with: [])
    }

    private func resetPreviewPlayer() async -> Void {
        if previewPlayer != nil {
            await previewPlayer?.pause()
            previewPlayer = nil
        }
    }

    private func reset() async -> Void {
        await resetMusicKit()
        await resetPreviewPlayer()
    }

    public override func observeValue(
        forKeyPath keyPath: String?,
        of object: Any?,
        change: [NSKeyValueChangeKey : Any]?,
        context: UnsafeMutableRawPointer?) {

        if keyPath == "rate", let player = object as? AVPlayer, let item = player.currentItem {
            if player.rate == 1 {
                notifyListeners("playbackStateDidChange", data: ["result": "playing"])
            } else if item.duration == player.currentTime() {
                notifyListeners("playbackStateDidChange", data: ["result": "completed"])
            } else {
                notifyListeners("playbackStateDidChange", data: ["result": "paused"])
            }
        }
    }

    // ref: https://app.quicktype.io/
    //    {
    //         "results": {
    //             "library-songs": {
    //                 "data": [{
    //                     "attributes": {
    //                         "name": "D8: バトル〜Adel",
    //                         "albumName": "DESTINY 8 - SaGa Band Arrangement Album Vol.2",
    //                         "playParams": {
    //                            "id": "i.xxxxxxxxxxxxxx",
    //                            "isLibrary": true,
    //                            "kind": "song",
    //                            "purchasedId": "1577159951",
    //                            "reporting": false,
    //                            "catalogId": "1175972539"
    //                         }
    //                     },
    //                     "id": ""
    //                 }]
    //             }
    //         }
    //    }

    // MARK: - LibrarySongsResults
    struct LibrarySongsResults: Codable {
        let results: Results?
    }

    // MARK: - Results
    struct Results: Codable {
        let librarySongs: LibrarySongs?

        enum CodingKeys: String, CodingKey {
            case librarySongs = "library-songs"
        }
    }

    // MARK: - LibrarySongs
    struct LibrarySongs: Codable {
        let data: [Datum]?
    }

    // MARK: - Datum
    struct Datum: Codable {
        let attributes: Attributes?
        let id: String?
    }

    // MARK: - Attributes
    struct Attributes: Codable {
        let name, albumName: String?
        let playParams: PlayParams?
    }

    // MARK: - PlayParams
    struct PlayParams: Codable {
        let id: String?
        let isLibrary: Bool?
        let kind, purchasedID: String?
        let reporting: Bool?
        let catalogID: String?

        enum CodingKeys: String, CodingKey {
            case id, isLibrary, kind
            case purchasedID = "purchasedId"
            case reporting
            case catalogID = "catalogId"
        }
    }
}
