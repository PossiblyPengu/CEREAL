using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Windows.Media.Control;

namespace MediaInfoTool
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);

        const byte VK_MEDIA_PLAY_PAUSE = 0xB3;
        const byte VK_MEDIA_NEXT_TRACK = 0xB0;
        const byte VK_MEDIA_PREV_TRACK = 0xB1;
        const byte VK_MEDIA_STOP       = 0xB2;

        static async Task Main(string[] args)
        {
            if (args.Length >= 2 && args[0] == "sendKey")
            {
                byte vk = 0;
                if (args[1] == "play" || args[1] == "pause" || args[1] == "playpause") vk = VK_MEDIA_PLAY_PAUSE;
                else if (args[1] == "next")                                             vk = VK_MEDIA_NEXT_TRACK;
                else if (args[1] == "prev" || args[1] == "previous")                   vk = VK_MEDIA_PREV_TRACK;
                else if (args[1] == "stop")                                             vk = VK_MEDIA_STOP;

                if (vk != 0)
                {
                    keybd_event(vk, 0, 0, UIntPtr.Zero);
                    keybd_event(vk, 0, 2, UIntPtr.Zero);
                }
                Console.WriteLine("{\"ok\":true}");
                return;
            }

            await GetMediaInfo();
        }

        static async Task GetMediaInfo()
        {
            try
            {
                var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                if (manager == null) { Console.WriteLine("{\"error\":\"no manager\"}"); return; }

                var session = manager.GetCurrentSession();
                if (session == null)
                {
                    var sessions = manager.GetSessions();
                    if (sessions.Count == 0) { Console.WriteLine("{\"error\":\"no sessions\"}"); return; }
                    session = sessions[0];
                }

                var props = await session.TryGetMediaPropertiesAsync();
                var pb    = session.GetPlaybackInfo();
                var tl    = session.GetTimelineProperties();

                bool   playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                string title   = (props.Title       ?? "").Replace("\"", "\\\"");
                string artist  = (props.Artist      ?? "").Replace("\"", "\\\"");
                string album   = (props.AlbumTitle  ?? "").Replace("\"", "\\\"");
                int    pos     = (int)tl.Position.TotalSeconds;
                int    dur     = (int)tl.EndTime.TotalSeconds;
                string source  = session.SourceAppUserModelId ?? "";

                Console.WriteLine(
                    "{\"title\":\"" + title + "\",\"artist\":\"" + artist +
                    "\",\"album\":\"" + album + "\",\"playing\":" + playing.ToString().ToLower() +
                    ",\"position\":" + pos + ",\"duration\":" + dur +
                    ",\"source\":\"" + source + "\"}");
            }
            catch (Exception ex)
            {
                Console.WriteLine("{\"error\":\"" + ex.Message.Replace("\"", "\\\"") + "\"}");
            }
        }
    }
}
