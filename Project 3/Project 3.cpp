#include <iostream> 
#include <string> 
using namespace std;

int main()
{
    int shiftkey;
    int choice;
    string result;
    string input1;

    // Read and write text one word at a time
    cout << "Enter your message: ";
    getline(cin, input1);

    cout << "What would you like your shift key to be?" << endl;
    cin >> shiftkey;
    //User chooses encryption or decryption
    cout << "\nEnter your choice \n1. Encryption \n2. Decryption \n";
    cout << "Your choice: ";
    cin >> choice;

    if (choice == 1)
    {
        for (int i = 0; i < input1.length(); i++)
        {
            //Encrypt uppercase
            if (isupper(input1[i]))
            {
                result += char(int(input1[i] + shiftkey - 65) % 26 + 65);

            }

            //Encrypt lowercase
            else
            {
                result += char(int(input1[i] + shiftkey - 97) % 26 + 97);
            }

        }

        cout << result;
    }

    if (choice == 2)
    {
        shiftkey = 26 - shiftkey;

        for (int i = 0; i < input1.length(); i++)
        {
            //Encrypt uppercase
            if (isupper(input1[i]))
            {
                result += char(int(input1[i] + shiftkey - 65) % 26 + 65);

            }

            //Encrypt lowercase
            else
            {
                result += char(int(input1[i] + shiftkey - 97) % 26 + 97);
            }
        }

        cout << result;
    }
}
