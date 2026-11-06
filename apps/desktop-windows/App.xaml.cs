using System.Windows;

namespace Ojowacam.Desktop;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        
        // Initialize application services
        // DiscoveryService, PairingService, StreamingService will be initialized here
        
        // Show main window
        var mainWindow = new MainWindow();
        mainWindow.Show();
    }
}
