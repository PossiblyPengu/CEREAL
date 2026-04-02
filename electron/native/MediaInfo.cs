using System;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using Windows.Media.Control;
using Windows.Foundation;

class MediaInfo
{
    static async Task Main(string[] args)
    {
        try
        {
            Console.WriteLine(@"{""debug"":""Starting C# media query""}");
            
            var manager = await GlobalSystemMediaTransportControlsSessionManager.RequestAsync();
            if (manager == null)
            {
                Console.WriteLine(@"{""debug"":""No session manager""}");
                Console.WriteLine("{}");
                return;
            }
            Console.WriteLine(@"{""debug"":""Got session manager""}");

            var session = manager.GetCurrentSession();
            if (session == null)
            {
                var sessions = manager.GetSessions();
                Console.WriteLine($@"{""debug"":""No current session, found {sessions.Count} sessions""}");
                if (sessions.Count == 0)
                {
                    Console.WriteLine("{}");
                    return;
                }
                session = sessions[0];
            }
            
            Console.WriteLine($@"{""debug"":""Got session: {session.SourceAppUserModelId}""}");

            var props = await session.TryGetMediaPropertiesAsync();
            var pb = session.GetPlaybackInfo();
            var tl = session.GetTimelineProperties();
            
            Console.WriteLine(@"{""debug"":""Got all properties""}");

            var playing = pb.PlaybackStatus == GlobalSystemMediaTransportControlsSessionPlaybackStatus.Playing;
            var title = props.Title?.Replace("\"", "\\\"") ?? "";
            var artist = props.Artist?.Replace("\"", "\\\"") ?? "";
            var album = props.AlbumTitle?.Replace("\"", "\\\"") ?? "";
            var pos = (int)tl.Position.TotalSeconds;
            var dur = (int)tl.EndTime.TotalSeconds;

            Console.WriteLine($@"{{""title"":""{title}"",""artist"":""{artist}"",""album"":""{album}"",""playing"":{playing.ToString().ToLower()},""position"":{pos},""duration"":{dur}}}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($@"{""error"":""{ex.Message.Replace("\"", "\\\"")}""}");
        }
    }
}
