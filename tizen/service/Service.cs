// Reads the TV's own settings that a web app can't (ECO, power, HDMI-CEC, Art Mode's learned brightness) and hands
// them back to Frame TV, which launched it with a reply request; then it quits. The keys need only the privilege every
// app has (internal/default/public), so no root.
using System;
using System.Runtime.InteropServices;
using System.Text;
using Tizen.Applications;

class Service : ServiceApplication
{
    const string Lib = "libvconf.so.0";
    [DllImport(Lib)] static extern int vconf_get_int(string key, out int val);
    [DllImport(Lib)] static extern int vconf_get_bool(string key, out int val);
    [DllImport(Lib)] static extern IntPtr vconf_get_str(string key);
    [DllImport("libc.so.6")] static extern void free(IntPtr p);

    static readonly string[] Ints = {
        "db/menu/system/eco_solution/auto_power_off", "db/menu/system/eco_solution/energy_saving",
        "db/menu/system/eco_solution/no_signal_power_off", "db/menu/system/power_control/network_standby",
        "db/menu/system/hdmicec/on_off", "db/menu/system/hdmicec/auto_turn_off", "db/menu/system/time/sleep_timer",
        "db/sysman/panel_display_time", "db/sysman/last_poweroff_time" };
    static readonly string[] Bools = { "db/menu/system/eco_solution/eco_sensor/value" };
    static readonly string[] Strings = {
        "db/sysman/pwr_on_type", "db/sp-kpi/power_off_reason", "db/screend/settings/frame_backlight_info",
        "db/screend/setting" };

    static string Quote(string s)
    {
        var b = new StringBuilder("\"");
        foreach (char c in s)
        {
            if (c == '"' || c == '\\') b.Append('\\').Append(c);
            else if (c < ' ') b.Append(' ');
            else b.Append(c);
        }
        return b.Append('"').ToString();
    }

    // {"key": value}; a key the TV doesn't have is left out
    static string Read()
    {
        var parts = new StringBuilder();
        Action<string, string> add = (k, v) => parts.Append(parts.Length > 0 ? "," : "").Append(Quote(k)).Append(':').Append(v);
        int n;
        foreach (var k in Ints)
            if (vconf_get_int(k, out n) == 0) add(k, n.ToString());
        foreach (var k in Bools)
            if (vconf_get_bool(k, out n) == 0) add(k, n != 0 ? "true" : "false");
        foreach (var k in Strings)
        {
            IntPtr p = vconf_get_str(k);
            if (p == IntPtr.Zero) continue;
            add(k, Quote(Marshal.PtrToStringUTF8(p)));
            free(p);
        }
        return "{" + parts + "}";
    }

    protected override void OnAppControlReceived(AppControlReceivedEventArgs e)
    {
        base.OnAppControlReceived(e);
        string json;
        try { json = Read(); }
        catch (Exception x) { json = "{\"error\":" + Quote(x.GetType().Name + ": " + x.Message) + "}"; }
        try
        {
            var reply = new AppControl();
            reply.ExtraData.Add("settings", json);
            e.ReceivedAppControl.ReplyToLaunchRequest(reply, AppControlReplyResult.Succeeded);
        }
        catch (Exception) { }
        Exit();
    }

    static void Main(string[] args) { new Service().Run(args); }
}
