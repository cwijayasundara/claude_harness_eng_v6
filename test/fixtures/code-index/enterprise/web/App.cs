using Acme.Core;

namespace Acme.Web;

public class App
{
    public void Run()
    {
        var s = new Service();
        s.Do();
    }
}
