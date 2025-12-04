"""Debug and diagnostics endpoints for network troubleshooting."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from typing import Optional, List
import httpx
import socket
import asyncio
from urllib.parse import urlparse

router = APIRouter()


class PingRequest(BaseModel):
    host: str


class DnsRequest(BaseModel):
    hostname: str


class HttpTestRequest(BaseModel):
    url: str
    timeout: int = 10


@router.post("/dns-lookup")
async def dns_lookup(request: DnsRequest):
    """Perform DNS lookup for a hostname."""
    try:
        hostname = request.hostname
        # Remove protocol if present
        if "://" in hostname:
            hostname = urlparse(hostname).hostname or hostname
        
        # Get all IPs
        results = socket.getaddrinfo(hostname, None)
        ips = list(set([r[4][0] for r in results]))
        
        return {
            "success": True,
            "hostname": hostname,
            "ips": ips,
            "message": f"DNS aufgelöst: {hostname} -> {', '.join(ips)}"
        }
    except socket.gaierror as e:
        return {
            "success": False,
            "hostname": request.hostname,
            "error": str(e),
            "message": f"DNS-Auflösung fehlgeschlagen: {e}"
        }
    except Exception as e:
        return {
            "success": False,
            "hostname": request.hostname,
            "error": str(e),
            "message": f"Fehler: {e}"
        }


@router.post("/tcp-connect")
async def tcp_connect(request: PingRequest):
    """Test TCP connection to a host:port."""
    try:
        host = request.host
        port = 443  # Default HTTPS
        
        # Parse host and port
        if "://" in host:
            parsed = urlparse(host)
            host = parsed.hostname or host
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
        elif ":" in host:
            parts = host.rsplit(":", 1)
            host = parts[0]
            port = int(parts[1])
        
        # Try to connect
        loop = asyncio.get_event_loop()
        start = loop.time()
        
        reader, writer = await asyncio.wait_for(
            asyncio.open_connection(host, port),
            timeout=5.0
        )
        
        elapsed = (loop.time() - start) * 1000
        writer.close()
        await writer.wait_closed()
        
        return {
            "success": True,
            "host": host,
            "port": port,
            "latency_ms": round(elapsed, 2),
            "message": f"TCP-Verbindung zu {host}:{port} erfolgreich ({elapsed:.0f}ms)"
        }
    except asyncio.TimeoutError:
        return {
            "success": False,
            "host": request.host,
            "error": "Timeout",
            "message": f"Timeout: Keine Verbindung zu {request.host} innerhalb von 5 Sekunden"
        }
    except Exception as e:
        return {
            "success": False,
            "host": request.host,
            "error": str(e),
            "message": f"Verbindung fehlgeschlagen: {e}"
        }


@router.post("/http-test")
async def http_test(request: HttpTestRequest):
    """Test HTTP/HTTPS connection to a URL."""
    try:
        url = request.url
        if not url.startswith("http"):
            url = f"https://{url}"
        
        # First test without following redirects
        async with httpx.AsyncClient(timeout=request.timeout, verify=False, follow_redirects=False) as client:
            response = await client.get(url)
            
            redirect_info = None
            if response.status_code in [301, 302, 303, 307, 308]:
                redirect_location = response.headers.get("location", "")
                redirect_info = {
                    "redirects_to": redirect_location,
                    "hint": "Paperless leitet um! Versuche die Ziel-URL direkt."
                }
            
            return {
                "success": True,
                "url": url,
                "status_code": response.status_code,
                "headers": dict(response.headers),
                "content_length": len(response.content),
                "redirect_info": redirect_info,
                "message": f"HTTP {response.status_code} - {len(response.content)} Bytes empfangen"
            }
    except httpx.ConnectError as e:
        return {
            "success": False,
            "url": request.url,
            "error": "ConnectError",
            "details": str(e),
            "message": f"Verbindungsfehler: Kann {request.url} nicht erreichen"
        }
    except httpx.TimeoutException:
        return {
            "success": False,
            "url": request.url,
            "error": "Timeout",
            "message": f"Timeout nach {request.timeout} Sekunden"
        }
    except Exception as e:
        return {
            "success": False,
            "url": request.url,
            "error": type(e).__name__,
            "details": str(e),
            "message": f"Fehler: {e}"
        }


class PaperlessTestRequest(BaseModel):
    url: str
    token: Optional[str] = None
    timeout: int = 10


@router.post("/paperless-test")
async def paperless_test(request: PaperlessTestRequest):
    """Test Paperless-ngx API connection."""
    results = []
    url = request.url.rstrip("/")
    
    # Test different URL variations
    test_urls = [
        f"{url}/api/",
        f"{url}/api",
        url,
    ]
    
    # If HTTP, also try HTTPS
    if url.startswith("http://"):
        https_url = url.replace("http://", "https://")
        test_urls.extend([
            f"{https_url}/api/",
            https_url,
        ])
    
    headers = {}
    if request.token:
        headers["Authorization"] = f"Token {request.token}"
    
    working_url = None
    final_status = None
    is_paperless = False
    redirect_target = None
    
    try:
        async with httpx.AsyncClient(timeout=request.timeout, verify=False, follow_redirects=True) as client:
            for test_url in test_urls:
                try:
                    response = await client.get(test_url, headers=headers)
                    results.append({
                        "url": test_url,
                        "status": response.status_code,
                        "final_url": str(response.url)
                    })
                    
                    if response.status_code == 200:
                        content = response.text.lower()
                        final_url_str = str(response.url)
                        # Check for Paperless indicators
                        is_paperless_api = (
                            "correspondents" in content or 
                            "documents" in content or 
                            "tags" in content or
                            "paperless" in content or
                            "/api/schema" in final_url_str or
                            "openapi" in content
                        )
                        if is_paperless_api:
                            working_url = test_url
                            final_status = response.status_code
                            is_paperless = True
                            if final_url_str != test_url:
                                redirect_target = final_url_str
                            break
                except Exception as e:
                    results.append({
                        "url": test_url,
                        "error": str(e)
                    })
        
        if working_url:
            return {
                "success": True,
                "url": url,
                "working_url": working_url,
                "redirect_target": redirect_target,
                "status_code": final_status,
                "is_paperless": is_paperless,
                "tested_urls": results,
                "message": f"Paperless API gefunden! Nutze: {redirect_target or working_url}"
            }
        else:
            # Check if we got redirects
            redirect_info = None
            async with httpx.AsyncClient(timeout=request.timeout, verify=False, follow_redirects=False) as client:
                try:
                    resp = await client.get(f"{url}/api/", headers=headers)
                    if resp.status_code in [301, 302, 303, 307, 308]:
                        redirect_info = resp.headers.get("location")
                except:
                    pass
            
            return {
                "success": False,
                "url": url,
                "tested_urls": results,
                "redirect_detected": redirect_info,
                "is_paperless": False,
                "message": f"Paperless API nicht gefunden. Redirect zu: {redirect_info}" if redirect_info else "Paperless API nicht gefunden",
                "hint": "Versuche HTTPS oder prüfe ob ein API-Token benötigt wird"
            }
    except Exception as e:
        return {
            "success": False,
            "url": request.url,
            "error": str(e),
            "tested_urls": results,
            "message": f"Paperless nicht erreichbar: {e}"
        }


@router.get("/network-info")
async def get_network_info():
    """Get container network information."""
    try:
        hostname = socket.gethostname()
        local_ip = socket.gethostbyname(hostname)
        
        # Try to get all interfaces
        interfaces = []
        try:
            import subprocess
            result = subprocess.run(["ip", "addr"], capture_output=True, text=True, timeout=5)
            interfaces = result.stdout.split("\n") if result.returncode == 0 else []
        except:
            pass
        
        # Test common hosts
        dns_servers = []
        try:
            with open("/etc/resolv.conf", "r") as f:
                for line in f:
                    if line.startswith("nameserver"):
                        dns_servers.append(line.split()[1])
        except:
            pass
        
        return {
            "hostname": hostname,
            "local_ip": local_ip,
            "dns_servers": dns_servers,
            "interfaces": interfaces[:20] if interfaces else ["Nicht verfügbar"]
        }
    except Exception as e:
        return {
            "error": str(e)
        }


@router.get("/common-tests")
async def run_common_tests():
    """Run common connectivity tests."""
    tests = []
    
    # Test DNS
    for host in ["google.com", "github.com"]:
        try:
            ips = socket.gethostbyname(host)
            tests.append({"test": f"DNS: {host}", "success": True, "result": ips})
        except Exception as e:
            tests.append({"test": f"DNS: {host}", "success": False, "result": str(e)})
    
    # Test HTTPS
    async with httpx.AsyncClient(timeout=5, verify=False) as client:
        for url in ["https://google.com", "https://api.openai.com"]:
            try:
                r = await client.get(url)
                tests.append({"test": f"HTTPS: {url}", "success": True, "result": f"HTTP {r.status_code}"})
            except Exception as e:
                tests.append({"test": f"HTTPS: {url}", "success": False, "result": str(e)})
    
    return {"tests": tests}

