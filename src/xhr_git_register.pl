#!/opt/local/bin/perl
# chrome拡張ではシェルコマンドを実行できない．回避策として，
# chrome拡張側からXHRでこちらにリクエストを投げて，git登録&ハッシュ計算する．
use strict;
use warnings;
use HTTP::Daemon;
use HTTP::Date;
use IPC::Open2;

# Todo: ポート番号再利用のオプションを有効にしたい
my $daemon = HTTP::Daemon->new (LocalAddr => '0.0.0.0',
				LocalPort => shift || 10000,
				ReuseAddr => 1)
    or die $!;

while (my ($client, $peer_addr) = $daemon->accept) {
    while (my $req = $client->get_request) {
	# バッククォートを使うと，Perl変数の内容を標準入力に渡すのが難しい
	# （エスケープ処理はややこしいので使いたくない）ので，open2を使用．
	my $pid = open2(*READ, *WRITE, "cd ~/.tcc; git hash-object -w --stdin");
	print (WRITE $req->content);
	close (WRITE);
	# printf ("======\n%s=====\n", $req->content);
	my $hash = <READ>;
	$hash =~ s/[\r\n]+\z//g;

        my $header = HTTP::Headers->new('Content-Type' => 'text/plain');
        my $res = HTTP::Response->new(200, 'OK', $header, $hash);
        $client->send_response($res);
	# print_log($peer_addr, $req, $res);
    }
    $client->close;
    undef($client);
}

sub print_log {
    use Socket qw/sockaddr_in inet_ntoa/;    # to deparse $peer_addr
    use bytes ();                            # for length
    my ( $peer_addr, $req, $res) = @_;
    my ( $port, $iaddr ) = sockaddr_in($peer_addr);
    my $remote_addr = inet_ntoa($iaddr);
    my $remote_user = $req->headers->authorization_basic || '-';
    $remote_user =~ s/:.*//o;
    printf qq(%s %s - [%s] "%s %s %s" %d %d\n===\n%s\n===\n%s\n---\n), 
        $remote_addr, $remote_user, time2str(time()),
         $req->method, $req->url, $req->protocol,
         $res->code, bytes::length($res->content), $res->content, $req->content;
}
