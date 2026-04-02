#include <napi.h>
#include <windows.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <winrt/Windows.Media.Control.h>
#include <winrt/Windows.Storage.Streams.h>

using namespace winrt;
using namespace Windows::Foundation;
using namespace Windows::Media::Control;
using namespace Windows::Storage::Streams;

// Convert hstring to std::string
std::string toString(const winrt::hstring& hs) {
    if (hs.empty()) return "";
    int size = WideCharToMultiByte(CP_UTF8, 0, hs.c_str(), -1, nullptr, 0, nullptr, nullptr);
    std::string result(size - 1, 0);
    WideCharToMultiByte(CP_UTF8, 0, hs.c_str(), -1, result.data(), size, nullptr, nullptr);
    return result;
}

// Get media info synchronously
Napi::Object GetMediaInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    // Declare these outside try so catch can access them
    bool needsWinrtInit = false;
    bool needsUninit = false;

    try {
        // Try to initialize WinRT - may already be initialized by Electron
        HRESULT hr = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
        
        // If already initialized with different mode, that's okay - we can still use COM
        if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
            result.Set("playing", Napi::Boolean::New(env, false));
            return result;
        }
        
        // Only init winrt apartment if we successfully initialized COM fresh
        // If RPC_E_CHANGED_MODE, COM is already initialized so we skip winrt::init_apartment
        needsWinrtInit = (hr == S_OK);
        needsUninit = SUCCEEDED(hr);

        if (needsWinrtInit) {
            winrt::init_apartment();
        }

        // Get session manager
        auto manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().get();
        if (!manager) {
            result.Set("playing", Napi::Boolean::New(env, false));
            if (needsWinrtInit) winrt::uninit_apartment();
            if (needsUninit) CoUninitialize();
            return result;
        }

        // Get current session
        auto session = manager.GetCurrentSession();
        if (!session) {
            // Try to get any session
            auto sessions = manager.GetSessions();
            if (sessions.Size() == 0) {
                result.Set("playing", Napi::Boolean::New(env, false));
                if (needsWinrtInit) winrt::uninit_apartment();
                if (needsUninit) CoUninitialize();
                return result;
            }
            session = sessions.GetAt(0);
        }

        // Get media properties
        auto props = session.TryGetMediaPropertiesAsync().get();
        auto playback = session.GetPlaybackInfo();
        auto timeline = session.GetTimelineProperties();

        // Build result
        result.Set("title", Napi::String::New(env, toString(props.Title())));
        result.Set("artist", Napi::String::New(env, toString(props.Artist())));
        result.Set("album", Napi::String::New(env, toString(props.AlbumTitle())));
        result.Set("playing", Napi::Boolean::New(env, playback.PlaybackStatus() == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing));
        
        // Get source app name
        auto source = session.SourceAppUserModelId();
        result.Set("source", Napi::String::New(env, toString(source)));
        
        // Read album art thumbnail as a base64 data URL
        std::string thumbDataUrl;
        try {
            auto thumbRef = props.Thumbnail();
            if (thumbRef) {
                auto stream = thumbRef.OpenReadAsync().get();
                if (stream) {
                    auto size = static_cast<uint32_t>(stream.Size());
                    if (size > 0 && size <= 2 * 1024 * 1024) { // cap at 2 MB
                        Buffer buf(size);
                        auto filled = stream.ReadAsync(buf, size, InputStreamOptions::None).get();
                        auto reader = DataReader::FromBuffer(filled);
                        auto byteCount = reader.UnconsumedBufferLength();
                        if (byteCount > 0) {
                            std::vector<uint8_t> bytes(byteCount);
                            reader.ReadBytes(bytes);

                            // Base64 encode
                            static const char b64[] =
                                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
                            std::string encoded;
                            encoded.reserve(((byteCount + 2) / 3) * 4);
                            for (uint32_t i = 0; i < byteCount; i += 3) {
                                uint32_t b = bytes[i] << 16;
                                if (i + 1 < byteCount) b |= bytes[i + 1] << 8;
                                if (i + 2 < byteCount) b |= bytes[i + 2];
                                encoded += b64[(b >> 18) & 0x3F];
                                encoded += b64[(b >> 12) & 0x3F];
                                encoded += (i + 1 < byteCount) ? b64[(b >> 6) & 0x3F] : '=';
                                encoded += (i + 2 < byteCount) ? b64[b & 0x3F] : '=';
                            }

                            std::string ct = toString(stream.ContentType());
                            if (ct.empty()) ct = "image/jpeg";
                            thumbDataUrl = "data:" + ct + ";base64," + encoded;
                        }
                    }
                }
            }
        } catch (...) {
            // Thumbnail failure is non-fatal — leave thumbDataUrl empty
        }
        result.Set("thumbnail", Napi::String::New(env, thumbDataUrl));
        
        auto pos = timeline.Position();
        auto dur = timeline.EndTime();
        result.Set("position", Napi::Number::New(env, static_cast<double>(pos.count()) / 10000000.0)); // Convert to seconds
        result.Set("duration", Napi::Number::New(env, static_cast<double>(dur.count()) / 10000000.0));

        // Cleanup
        if (needsWinrtInit) {
            winrt::uninit_apartment();
        }
        if (needsUninit) {
            CoUninitialize();
        }

    } catch (const winrt::hresult_error& e) {
        result.Set("error", Napi::String::New(env, toString(e.message())));
        result.Set("playing", Napi::Boolean::New(env, false));
        if (needsWinrtInit) winrt::uninit_apartment();
        if (needsUninit) CoUninitialize();
    } catch (...) {
        result.Set("error", Napi::String::New(env, "Unknown exception"));
        result.Set("playing", Napi::Boolean::New(env, false));
        if (needsWinrtInit) winrt::uninit_apartment();
        if (needsUninit) CoUninitialize();
    }

    return result;
}

// Send media key
void SendMediaKey(const Napi::CallbackInfo& info) {
    if (info.Length() < 1 || !info[0].IsString()) return;
    
    std::string action = info[0].As<Napi::String>().Utf8Value();
    
    WORD vk = 0;
    if (action == "playpause") vk = VK_MEDIA_PLAY_PAUSE;
    else if (action == "next") vk = VK_MEDIA_NEXT_TRACK;
    else if (action == "prev") vk = VK_MEDIA_PREV_TRACK;
    else return;

    // Send key press
    keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY, 0);
    keybd_event(vk, 0, KEYEVENTF_EXTENDEDKEY | KEYEVENTF_KEYUP, 0);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getMediaInfo", Napi::Function::New(env, GetMediaInfo));
    exports.Set("sendMediaKey", Napi::Function::New(env, SendMediaKey));
    return exports;
}

NODE_API_MODULE(smtc, Init)
