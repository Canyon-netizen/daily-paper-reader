from src.elo_debate import *

def test_update_elo():
    a, b = update_elo(1200, 1200, 'a')
    assert a == 1216 and b == 1184

def test_swiss_pairs():
    xs=[{'id':str(i),'elo_rating':1200+i} for i in range(4)]
    assert [(a['id'],b['id']) for a,b in swiss_pairs(xs)] == [('3','2'),('1','0')]

def test_failure_isolation():
    calls=[]
    def judge(a,b,r):
        calls.append(r)
        if len(calls)==1: raise RuntimeError('x')
        return 'a'
    out=run_debate([{'id':'a'},{'id':'b'}],judge,rounds=2)
    assert len(calls)==2 and out[0]['id']=='a'

def test_budget():
    out=run_debate([{'id':'a'},{'id':'b'}],lambda a,b,r:'a',rounds=3,budget_tokens=16000)
    assert out[0]['elo_rating'] > 1200

def test_tie():
    out=run_debate([{'id':'a'},{'id':'b'}],lambda a,b,r:'tie')
    assert all(i['elo_rating']==1200 for i in out)

def test_judge_failure():
    assert judge_debate({}, {}, lambda a,b: (_ for _ in ()).throw(RuntimeError())) == 'tie'
