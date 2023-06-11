#coding=utf-8
import re
import urllib
import requests
from bs4 import BeautifulSoup
from urllib import request
from http import cookiejar
from tqdm import tqdm
fileName = 'OUT'
cookieJar = cookiejar.CookieJar()
cookieList = []
debug = False
indexId = 1
ipAddr = '192.168.0.6'

def getAuthorization():
	print('正在取得授權...')
	global cookieList, cookieJar
	cookieJar = cookiejar.CookieJar()
	handler=request.HTTPCookieProcessor(cookieJar)
	opener = request.build_opener(handler)
	response = opener.open('http://'+ipAddr+'/authorize?username=admin&password=admin')
	cookieList = requests.utils.dict_from_cookiejar(cookieJar)
	if debug:
		print(cookieList)
	print('[sysInfo]Get Authorization Code Success! Authorization: ', cookieList['Authorization'])

def getDetailById():
	print('正在檔案詳細資訊...')
	global cookieJar, fileName
	link = 'http://'+ipAddr+'/playback.lgi?id=' + str(indexId)
	req = requests.post(link,cookies=cookieJar)
	soup = BeautifulSoup(req.content, 'html.parser')
	a_tags = soup.find_all('a',attrs={'href':re.compile('OUT*|IN*')})
	fileName = str(a_tags[0].string)

def downloadMp3File():
	print('正在下載...')
	global cookieList, fileName
	path = './' + fileName.replace('.wav','.mp3')
	if fileName[0:3] == 'OUT':
		link = 'http://'+ipAddr+'/service/decode/mp3/' + fileName.replace('.wav','.mp3') + '?__a=' + cookieList['Authorization'] + '&q=/record/' + fileName[4:8] + '/' + fileName[8:10] + '/' + fileName[10:12] + '/' + fileName
	elif fileName[0:2] == 'IN':
		link = 'http://'+ipAddr+'/service/decode/mp3/' + fileName.replace('.wav','.mp3') + '?__a=' + cookieList['Authorization'] + '&q=/record/' + fileName[3:7] + '/' + fileName[7:9] + '/' + fileName[9:11] + '/' + fileName
	print('[sysInfo]Download Link: ',link)
	urllib.request.urlretrieve(link,path)
	r = requests.get(link, stream=True)
	is_chunked = r.headers.get('transfer-encoding', '') == 'chunked'
	content_length_s = r.headers.get('content-length')
	if not is_chunked and content_length_s.isdigit():
		content_length = int(content_length_s)
	else:
		content_length = None
	pbar = tqdm(total=content_length, unit="b", unit_scale=True, ncols=100)
	with open(path, 'wb') as f:
		for chunk in r.iter_content(chunk_size=1024 * 1024):
			f.write(chunk)
			pbar.update(len(chunk))
		pbar.close()
	f.close()
	print('下載完成!')

# #_main_
while True:
	indexId = int(input('請輸入該錄音檔之Index序號:'))
	getAuthorization()
	getDetailById()
	downloadMp3File()