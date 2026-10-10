# -*- coding: utf-8 -*-
"""
背单词 APP · 本地 HTTPS 服务器
--------------------------------------------------
为什么需要它：安卓 Chrome / Edge 只允许在 HTTPS（或 localhost）下安装 PWA。
局域网 HTTP 地址（http://192.168.x.x）无法安装——这是浏览器的硬限制，不是 APP 的问题。

用法（在 G:\\dsh\\背单词APP 目录下）：
    python serve.py            # 默认 8443 端口，自动生成自签证书
    python serve.py 9443       # 换端口

手机访问：https://<电脑IP>:8443
第一次会提示"不安全"，点「高级」→「继续前往」即可，然后就能装到主屏幕。
"""
import http.server
import ipaddress
import os
import socket
import ssl
import sys
import datetime

HERE = os.path.dirname(os.path.abspath(__file__))
CERT_DIR = os.path.join(HERE, ".certs")
CERT = os.path.join(CERT_DIR, "cert.pem")
KEY = os.path.join(CERT_DIR, "key.pem")
PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8443


def lan_ips():
    """尽量找出本机的局域网 IP"""
    ips = set()
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ips.add(s.getsockname()[0])
        s.close()
    except Exception:
        pass
    try:
        for info in socket.getaddrinfo(socket.gethostname(), None, socket.AF_INET):
            ip = info[4][0]
            if not ip.startswith("127."):
                ips.add(ip)
    except Exception:
        pass
    return sorted(ips)


def make_cert(ips):
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"背单词APP 局域网证书"),
        x509.NameAttribute(NameOID.ORGANIZATION_NAME, u"Local Dev"),
    ])
    alt = [x509.DNSName(u"localhost")]
    for ip in ips + ["127.0.0.1"]:
        try:
            alt.append(x509.IPAddress(ipaddress.ip_address(ip)))
        except Exception:
            pass
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(alt), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(
            x509.KeyUsage(
                digital_signature=True, content_commitment=False, key_encipherment=True,
                data_encipherment=False, key_agreement=False, key_cert_sign=False,
                crl_sign=False, encipher_only=False, decipher_only=False,
            ),
            critical=True,
        )
        .add_extension(
            x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )

    os.makedirs(CERT_DIR, exist_ok=True)
    with open(KEY, "wb") as f:
        f.write(key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        ))
    with open(CERT, "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))
    return cert


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=HERE, **kw)

    def do_GET(self):
        # 别把私钥目录暴露出去
        if ".certs" in self.path:
            self.send_error(404, "Not Found")
            return
        super().do_GET()

    def end_headers(self):
        # 让手机每次都拿到最新的 HTML（否则改了看不到）
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, fmt, *args):
        sys.stderr.write("[%s] %s\n" % (self.log_date_time_string(), fmt % args))


def main():
    ips = lan_ips()
    if not (os.path.exists(CERT) and os.path.exists(KEY)):
        print("首次运行：正在生成自签证书（局域网 IP：%s）..." % ", ".join(ips or ["未检测到"]))
        make_cert(ips)
        print("证书已生成：%s" % CERT_DIR)
    else:
        print("使用已有证书：%s" % CERT_DIR)

    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(CERT, KEY)

    httpd = http.server.ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print("")
    print("=" * 58)
    print("  背单词 APP 已在运行（HTTPS）")
    print("")
    for ip in (ips or ["<电脑IP>"]):
        print("  手机打开： https://%s:%d" % (ip, PORT))
    print("  本机预览： https://127.0.0.1:%d" % PORT)
    print("")
    print("  手机第一次会提示证书不安全 → 点「高级」→「继续前往」")
    print("  之后即可「安装应用 / 添加到主屏幕」")
    print("  停止服务：按 Ctrl + C")
    print("=" * 58)
    print("")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n已停止。")


if __name__ == "__main__":
    main()
