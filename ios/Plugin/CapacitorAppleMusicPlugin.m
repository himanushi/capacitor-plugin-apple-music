#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Define the plugin using the CAP_PLUGIN Macro, and
// each method the plugin supports using the CAP_PLUGIN_METHOD macro.
CAP_PLUGIN(CapacitorAppleMusicPlugin, "CapacitorAppleMusic",
    CAP_PLUGIN_METHOD(echo, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(configure, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setVolume, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(isAuthorized, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(hasMusicSubscription, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(authorize, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(unauthorize, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setSong, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getLibraryAlbum, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(play, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(stop, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(pause, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(currentPlaybackDuration, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(currentPlaybackTime, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(seekToTime, CAPPluginReturnPromise);
)
