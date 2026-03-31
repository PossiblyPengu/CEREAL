using System;
using System.Threading.Tasks;
using Windows.Media.Control;

namespace MediaInfoTool
{
    class Program
    {
        static async Task Main(string[] args)
        {
            try
            {
                var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
                if (manager == null)
                {
                    Console.WriteLine("{\"error\":\"manager null\"}");
                    return;
                }

                var session = manager.GetCurrentSession();
                if (session == null)
                {
                    var sessions = manager.GetSessions();
                    if (sessions.Count == 0)
                    {
                        Console.WriteLine("{\"error\":\"no sessions\"}");
                        return;
                    }
                    session = sessions[0];
                }

                var props = await session.TryGetMediaPropertiesAsync();
                var pb = session.GetPlaybackInfo();
                var tl = session.GetTimelineProperties();

                var playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
                var title = props.Title?.Replace("\"", "\\\"") ?? "";
                var artist = props.Artist?.Replace("\"", "\\\"") ?? "";
                var album = props.AlbumTitle?.Replace("\"", "\\\"") ?? "";
                var pos = (int)tl.Position.TotalSeconds;
                var dur = (int)tl.EndTime.TotalSeconds;
                var source = session.SourceAppUserModelId ?? "";

                Console.WriteLine($"{{\"title\":\"{title}\",\"artist\":\"{artist}\",\"album\":\"{album}\",\"playing\":{playing.ToString().ToLower()},\"position\":{pos},\"duration\":{dur},\"source\":\"{source}\"}}");
            }
            catch (Exception ex)
            {
                Console.WriteLine($"{{\"error\":\"{ex.Message.Replace("\"", "\\\"")}\"}}");
            }
        }
    }
}
