import {randomUUID} from 'node:crypto';
import {Request, Response, NextFunction} from 'express';


const resquestIdMiddleware=(req:Request, res:Response, next:NextFunction) => {
  

  const requestId=`req_${randomUUID()}`;

  req.requestId=requestId;

  next();

}

export default resquestIdMiddleware;