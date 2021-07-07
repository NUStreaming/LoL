import org.mp4parser.Box;
import org.mp4parser.IsoFile;
import org.mp4parser.boxes.iso23009.part1.EventMessageBox;

import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.channels.FileChannel;

public class EmsgAppender {
  String fileName;
  public static final String SCHEME_ID_URI="urn:mpeg:dash:event:2012";
  public static final String VALUE="1";

  EmsgAppender(String fileName){
    this.fileName=fileName;
  }

  private void readFile() throws IOException {
    IsoFile isoFile=new IsoFile(fileName);
    for(Box box:isoFile.getBoxes()){
      if (box instanceof EventMessageBox){
        EventMessageBox readEmsg=(EventMessageBox) box;
        if (SCHEME_ID_URI.equals(readEmsg.getSchemeIdUri()) && VALUE.equals(readEmsg.getValue())){
          // already have the same emsg
          return;
        }
      }
    }
    // apppend emsg box
    EventMessageBox emsg=new EventMessageBox();
    emsg.setSchemeIdUri(SCHEME_ID_URI);
    emsg.setValue("1");
    long id=System.currentTimeMillis();
    emsg.setId(id);
    //emsg.setPresentationTimeDelta(1);
    //emsg.setEventDuration(1);
    emsg.setMessageData(new byte[0]);
    isoFile.addBox(emsg);
    FileChannel writableChannel=new FileOutputStream(fileName).getChannel();
    isoFile.writeContainer(writableChannel);
  }

  public static void main(String[] args) throws IOException {
    if (args.length==0){
        throw new IllegalArgumentException("fileName is required!!!");
    }
    EmsgAppender inst=new EmsgAppender(args[0]);
    inst.readFile();
  }
}
