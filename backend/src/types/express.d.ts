declare global{
  namespace Express{
    interface Request{
      requestId:String;
    }
  }
}

export{};